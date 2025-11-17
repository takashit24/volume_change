# mp3 音量そろえツール（仮）

ブラウザだけで動作する mp3 音量正規化ツールの Vite + React + TypeScript プロジェクトです。`@ffmpeg/ffmpeg`（ffmpeg.wasm）を組み込み、mp3 の読み込み・変換の準備ができています。

## 採用する技術スタック
- **Vite + React + TypeScript**: 軽量な開発体験と高速な HMR を提供するフロントエンド基盤。
- **ffmpeg.wasm (`@ffmpeg/ffmpeg`) + `@ffmpeg/util`**: ブラウザ内で mp3 の読み込み・一時変換を行うための WebAssembly 版 ffmpeg と補助ユーティリティ。
- **CSS Modules/プレーン CSS**: 初期段階ではシンプルなスタイリングのみ。必要に応じて UI ライブラリを追加。

## ディレクトリ構成案
- `src/main.tsx`: エントリーポイント。
- `src/App.tsx`: ルートコンポーネント。ffmpeg の初期化と UI 構成を担当。
- `src/components/FileDropZone.tsx`: ドラッグ＆ドロップ + ファイル選択で mp3 を受け付けるコンポーネント。
- `src/hooks/`: ffmpeg ライフサイクル管理や音量解析用のカスタムフックを配置予定。
- `src/utils/`: 変換ジョブ管理やファイル処理ヘルパーを配置予定。
- `src/styles/`: グローバルスタイルやテーマ関連ファイルを配置予定。
- `public/`: 静的アセットを配置（必要に応じて）。

## Vite プロジェクト作成コマンド例
`npm create` が使える環境の場合は以下の手順で同等の構成を作成できます。

```bash
npm create vite@latest . -- --template react-ts
```

## ffmpeg.wasm の導入・初期化手順
1. パッケージを追加
   ```bash
   npm install @ffmpeg/ffmpeg @ffmpeg/util
   ```
2. ブラウザで ffmpeg を初期化
   ```ts
   import { FFmpeg } from '@ffmpeg/ffmpeg';
   import { toBlobURL, fetchFile } from '@ffmpeg/util';

   const ffmpeg = new FFmpeg({ log: true });
   const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/';

   const coreURL = await toBlobURL(`${baseURL}ffmpeg-core.js`, 'text/javascript');
   const wasmURL = await toBlobURL(`${baseURL}ffmpeg-core.wasm`, 'application/wasm');
   const workerURL = await toBlobURL(`${baseURL}ffmpeg-core.worker.js`, 'text/javascript');

   await ffmpeg.load({ coreURL, wasmURL, workerURL });
   await ffmpeg.writeFile('input.mp3', await fetchFile(file));
   await ffmpeg.exec(['-i', 'input.mp3', 'output.wav']);
   ```
   ※ CDN からコアファイルを取得し、`toBlobURL` で同一オリジン化して読み込みます。

## 現在の UI と機能
- ffmpeg 初期化中は「ffmpeg 読み込み中…」メッセージを表示。
- 初期化完了後にドラッグ＆ドロップ/ファイル選択で複数 mp3 を受け付け、ファイル名とサイズを一覧表示。
- `volumedetect` を使って各 mp3 のピーク/平均レベルを解析し、一覧に結果を表示。
- 「目標ピークレベル(dB)」を入力し、「選択したファイルを正規化」ボタンで peak-based volume normalize を実行（`volume` フィルタ）。
- 処理中はファイルごとに進捗を表示し、完了後は `_normalized` を付けた mp3 をダウンロード可能。

## 開発環境の起動手順
1. 依存関係をインストール: `npm install`
2. 開発サーバーを起動: `npm run dev`
3. ブラウザで `http://localhost:5173/` を開く

※ 初期ロード時に ffmpeg コアを CDN から取得するため、開発時もネットワーク接続が必要です。

## デプロイ手順（例）
このリポジトリは静的サイトとしてビルドできるため、Vercel/Netlify/GitHub Pages などの静的ホスティングにそのまま載せられます。以下は代表的な手順例です。

### Vercel の場合
1. リポジトリを GitHub に push し、Vercel のダッシュボードで「Import Project」を選択。
2. Framework Preset に「Vite」を選択し、Build Command は `npm run build`、Output Directory は `dist` に設定。
3. デプロイ後に表示される URL が本番 URL になります（CDN 経由で `ffmpeg-core` を取得するため、ネットワークアクセスが必要です）。

### Netlify の場合
1. Netlify で新規サイトを作成し、GitHub のリポジトリを選択。
2. Build Command を `npm run build`、Publish directory を `dist` に設定。
3. デプロイが完了するとサイト URL が発行されます。

### GitHub Pages の場合
1. `npm run build` で `dist/` を生成。
2. `dist/` を `gh-pages` ブランチにデプロイ（例: `npm install -g gh-pages && gh-pages -d dist`）。
3. Pages 設定で `gh-pages` ブランチのルートを公開すれば、`https://<username>.github.io/<repo>/` で利用できます。

※ この環境では外部サービスへのデプロイが行えないため、上記手順を参考に任意のホスティング先で公開してください。
