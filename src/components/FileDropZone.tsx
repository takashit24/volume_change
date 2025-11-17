import type React from 'react';
import { useCallback, useRef, useState } from 'react';

interface FileDropZoneProps {
  onFilesAdded: (files: File[]) => void;
  disabled?: boolean;
}

function FileDropZone({ onFilesAdded, disabled }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const mp3Files = Array.from(fileList).filter(
        (file) => file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3'),
      );
      if (mp3Files.length > 0) {
        onFilesAdded(mp3Files);
      }
    },
    [onFilesAdded],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      setIsDragging(false);
      handleFiles(event.dataTransfer.files);
    },
    [disabled, handleFiles],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setIsDragging(true);
  }, [disabled]);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const onChangeInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(event.target.files);
      event.target.value = '';
    },
    [handleFiles],
  );

  return (
    <div
      className={`drop-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      role="presentation"
    >
      <input
        ref={inputRef}
        className="file-input"
        type="file"
        accept="audio/mpeg"
        multiple
        onChange={onChangeInput}
        disabled={disabled}
      />
      <p className="drop-zone__text">mp3 ファイルをドラッグ＆ドロップ</p>
      <p className="drop-zone__hint">または</p>
      <button
        className="file-button"
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        ファイルを選択
      </button>
    </div>
  );
}

export default FileDropZone;
