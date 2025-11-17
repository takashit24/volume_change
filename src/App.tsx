import { useEffect, useMemo, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import FileDropZone from './components/FileDropZone';
import './App.css';

const ffmpegCoreVersion = '0.12.10';
const ffmpegBaseUrl = `https://unpkg.com/@ffmpeg/core@${ffmpegCoreVersion}/dist/`;

type VolumeAnalysis = {
  maxVolumeDb: number | null;
  meanVolumeDb: number | null;
};

type ListedFile = {
  id: string;
  file: File;
  analysisStatus: 'pending' | 'running' | 'done' | 'error';
  analysisResult?: VolumeAnalysis;
  analysisError?: string;
  normalizeStatus: 'idle' | 'processing' | 'done' | 'error';
  normalizeProgress: number;
  normalizedUrl?: string;
  normalizeError?: string;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function App() {
  const ffmpeg = useMemo(() => new FFmpeg({ log: true }), []);
  const [isFfmpegLoading, setIsFfmpegLoading] = useState(true);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const [files, setFiles] = useState<ListedFile[]>([]);
  const [targetPeakDb, setTargetPeakDb] = useState('-1');
  const analyzingIdRef = useRef<string | null>(null);
  const normalizingIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadFfmpeg = async () => {
      setIsFfmpegLoading(true);
      setFfmpegError(null);
      try {
        const coreURL = await toBlobURL(`${ffmpegBaseUrl}ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${ffmpegBaseUrl}ffmpeg-core.wasm`, 'application/wasm');
        const workerURL = await toBlobURL(`${ffmpegBaseUrl}ffmpeg-core.worker.js`, 'text/javascript');
        await ffmpeg.load({ coreURL, wasmURL, workerURL });
        if (isMounted) {
          setFfmpegReady(true);
        }
      } catch (error) {
        console.error('ffmpeg load failed', error);
        if (isMounted) {
          setFfmpegError('ffmpeg の読み込みに失敗しました。リロードして再試行してください。');
        }
      } finally {
        if (isMounted) {
          setIsFfmpegLoading(false);
        }
      }
    };

    loadFfmpeg();

    return () => {
      isMounted = false;
    };
  }, [ffmpeg]);

  const handleFilesAdded = (incoming: File[]) => {
    setFiles((prev) => {
      const prevKeys = new Set(prev.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));
      const additions = incoming
        .filter((file) => file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3'))
        .filter((file) => !prevKeys.has(`${file.name}-${file.size}-${file.lastModified}`))
        .map((file) => ({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
          file,
          analysisStatus: 'pending',
          normalizeStatus: 'idle',
          normalizeProgress: 0,
        }));
      return [...prev, ...additions];
    });
  };

  const parseVolumedetect = (logs: string[]): VolumeAnalysis => {
    let maxVolume: number | null = null;
    let meanVolume: number | null = null;

    logs.forEach((line) => {
      const maxMatch = line.match(/max_volume:\s*([-+]?\d+(?:\.\d+)?)\s*dB/i);
      const meanMatch = line.match(/mean_volume:\s*([-+]?\d+(?:\.\d+)?)\s*dB/i);
      if (maxMatch) maxVolume = Number.parseFloat(maxMatch[1]);
      if (meanMatch) meanVolume = Number.parseFloat(meanMatch[1]);
    });

    return { maxVolumeDb: maxVolume, meanVolumeDb: meanVolume };
  };

  // volumedetect はログ出力を解析する必要があるため、実行中のファイルを ref で追跡して
  // 必要なメッセージだけを収集する。（ffmpeg はシングルインスタンスで動かす）
  useEffect(() => {
    if (!ffmpegReady) return;
    if (analyzingIdRef.current || normalizingIdRef.current) return;

    const next = files.find((file) => file.analysisStatus === 'pending');
    if (!next) return;

    analyzingIdRef.current = next.id;
    const inputName = `${next.id}-analysis.mp3`;
    const logMessages: string[] = [];
    const logHandler = ({ message }: { type: string; message: string }) => {
      if (analyzingIdRef.current === next.id) {
        logMessages.push(message);
      }
    };

    (ffmpeg as any).on?.('log', logHandler);

    const runAnalysis = async () => {
      setFiles((prev) =>
        prev.map((item) =>
          item.id === next.id
            ? { ...item, analysisStatus: 'running', analysisError: undefined }
            : item,
        ),
      );
      try {
        await ffmpeg.writeFile(inputName, await fetchFile(next.file));
        await ffmpeg.exec(['-i', inputName, '-af', 'volumedetect', '-f', 'null', '-']);

        const analysis = parseVolumedetect(logMessages);
        setFiles((prev) =>
          prev.map((item) =>
            item.id === next.id
              ? { ...item, analysisStatus: 'done', analysisResult: analysis }
              : item,
          ),
        );
      } catch (error) {
        console.error('volumedetect failed', error);
        setFiles((prev) =>
          prev.map((item) =>
            item.id === next.id
              ? {
                  ...item,
                  analysisStatus: 'error',
                  analysisError: '音量解析に失敗しました。',
                }
              : item,
          ),
        );
      } finally {
        try {
          await ffmpeg.deleteFile(inputName);
        } catch (error) {
          console.warn('cleanup failed after analysis', error);
        }

        (ffmpeg as any).off?.('log', logHandler);
        analyzingIdRef.current = null;
      }
    };

    runAnalysis();
  }, [ffmpeg, ffmpegReady, files]);

  const normalizeFile = async (item: ListedFile, targetDb: number) => {
    if (!item.analysisResult || item.analysisResult.maxVolumeDb === null) {
      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                normalizeStatus: 'error',
                normalizeError: '解析結果が取得できていません。',
              }
            : entry,
        ),
      );
      return;
    }

    // ピークベースのシンプルなゲイン計算。LUFS より軽量で wasm 実行時間を抑える狙い。
    const gainDb = targetDb - item.analysisResult.maxVolumeDb;
    const volumeArg = `volume=${gainDb.toFixed(2)}dB`;
    const inputName = `${item.id}-norm-in.mp3`;
    const outputName = `${item.id}-normalized.mp3`;
    normalizingIdRef.current = item.id;
    const progressHandler = ({ progress }: { progress: number }) => {
      if (normalizingIdRef.current === item.id) {
        setFiles((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? { ...entry, normalizeProgress: Math.min(1, Math.max(0, progress ?? 0)) }
              : entry,
          ),
        );
      }
    };

    (ffmpeg as any).on?.('progress', progressHandler);

    setFiles((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? { ...entry, normalizeStatus: 'processing', normalizeProgress: 0, normalizeError: undefined }
          : entry,
      ),
    );

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(item.file));
      await ffmpeg.exec(['-i', inputName, '-af', volumeArg, '-c:a', 'libmp3lame', outputName]);
      const outputData = await ffmpeg.readFile(outputName);
      const blob = new Blob([outputData], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                normalizeStatus: 'done',
                normalizeProgress: 1,
                normalizedUrl: url,
              }
            : entry,
        ),
      );
    } catch (error) {
      console.error('normalization failed', error);
      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                normalizeStatus: 'error',
                normalizeError: '正規化に失敗しました。',
              }
            : entry,
        ),
      );
    } finally {
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch (error) {
        console.warn('cleanup failed after normalization', error);
      }
      (ffmpeg as any).off?.('progress', progressHandler);
      normalizingIdRef.current = null;
    }
  };

  const handleNormalizeAll = async () => {
    if (!ffmpegReady) return;
    const targetDb = Number.parseFloat(targetPeakDb);
    const desiredTarget = Number.isFinite(targetDb) ? targetDb : -1;

    // ffmpeg.wasm はシングルワーカーで動かすため、シンプルに直列で処理キューを回す。
    for (const item of files) {
      await normalizeFile(item, desiredTarget);
    }
  };

  const isWorking = Boolean(analyzingIdRef.current || normalizingIdRef.current);
  const hasPendingAnalysis = files.some((file) => file.analysisStatus === 'pending' || file.analysisStatus === 'running');

  return (
    <main className="app">
      <header className="header">
        <h1>mp3 音量そろえツール（仮）</h1>
        <p className="lead">ブラウザだけで mp3 の音量をそろえるための実験的ツール</p>
      </header>

      {isFfmpegLoading && <div className="status">ffmpeg 読み込み中…</div>}
      {ffmpegError && <div className="status error">{ffmpegError}</div>}

      {ffmpegReady && !ffmpegError && (
        <section className="panel">
          <FileDropZone onFilesAdded={handleFilesAdded} disabled={isWorking} />
          <div className="controls">
            <label className="control">
              <span className="control__label">目標ピークレベル (dB)</span>
              <input
                type="number"
                className="control__input"
                value={targetPeakDb}
                onChange={(event) => setTargetPeakDb(event.target.value)}
                step="0.1"
                aria-label="目標ピークレベル"
              />
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={handleNormalizeAll}
              disabled={files.length === 0 || hasPendingAnalysis || isWorking}
            >
              選択したファイルを正規化
            </button>
          </div>
          <div className="file-list">
            <div className="file-list__header">
              <h2>読み込んだファイル</h2>
              <span className="file-count">{files.length} 件</span>
            </div>
            {files.length === 0 ? (
              <p className="empty">まだファイルがありません。</p>
            ) : (
              <ul>
                {files.map((item) => {
                  const normalizedName = `${item.file.name.replace(/\.mp3$/i, '')}_normalized.mp3`;
                  return (
                    <li key={item.id} className="file-item">
                      <div className="file-item__row">
                        <span className="file-name">{item.file.name}</span>
                        <span className="file-size">{formatFileSize(item.file.size)}</span>
                      </div>
                      <div className="file-item__row info">
                        <span className="badge">解析</span>
                        {item.analysisStatus === 'pending' && <span className="muted">解析待ち</span>}
                        {item.analysisStatus === 'running' && <span className="muted">解析中…</span>}
                        {item.analysisStatus === 'error' && <span className="error-text">{item.analysisError}</span>}
                        {item.analysisStatus === 'done' && (
                          <span className="analysis-result">
                            ピーク: {item.analysisResult?.maxVolumeDb ?? '不明'} dB / 平均: {item.analysisResult?.meanVolumeDb ?? '不明'} dB
                          </span>
                        )}
                      </div>
                      <div className="file-item__row info">
                        <span className="badge badge--accent">正規化</span>
                        {item.normalizeStatus === 'idle' && <span className="muted">未実行</span>}
                        {item.normalizeStatus === 'processing' && (
                          <span className="muted">
                            処理中… {Math.round((item.normalizeProgress ?? 0) * 100)}%
                          </span>
                        )}
                        {item.normalizeStatus === 'error' && (
                          <span className="error-text">{item.normalizeError ?? '正規化に失敗しました。'}</span>
                        )}
                        {item.normalizeStatus === 'done' && item.normalizedUrl && (
                          <a className="download-button" href={item.normalizedUrl} download={normalizedName}>
                            ダウンロード
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
