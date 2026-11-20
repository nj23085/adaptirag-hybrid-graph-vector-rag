import React, { useState } from 'react';
import {
  Download,
  X,
  FileCode,
  Check,
  Copy,
  Terminal,
  FolderArchive,
  Info,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { PROJECT_FILES, downloadProjectZip } from '../utils/exportZip';

interface ExportProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportProjectModal: React.FC<ExportProjectModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('query_cli.py');
  const [copiedFile, setCopiedFile] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleDownload = async () => {
    setIsExporting(true);
    setDownloadSuccess(false);
    try {
      await downloadProjectZip();
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 4000);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const currentFile = PROJECT_FILES.find(f => f.path === selectedFilePath) || PROJECT_FILES[0];

  const handleCopy = () => {
    if (!currentFile) return;
    navigator.clipboard.writeText(currentFile.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50/80">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                Export & Download Project Codebase
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-indigo-100 text-indigo-700 rounded-full">
                  Instant ZIP
                </span>
              </h2>
              <p className="text-xs text-zinc-500">
                Download the complete standalone Python backend, CLI tools, and test suites
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          
          {/* Note regarding AI Studio Settings */}
          <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/80 flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-amber-900 text-xs">
                Looking for "Export to ZIP" in AI Studio Settings?
              </h4>
              <p className="text-xs text-amber-800 leading-relaxed">
                In Google AI Studio, project export is not always available in the standard user Settings menu. 
                Instead, you can <strong>download the entire standalone project right here</strong> with one click! 
                It contains all 22 Python backend modules, FAISS vector indexer, Louvain GraphRAG engine, <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900">query_cli.py</code>, and quickstart scripts.
              </p>
            </div>
          </div>

          {/* Primary Action Button */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-50 via-white to-blue-50 border border-indigo-100 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
            <div>
              <h3 className="font-bold text-zinc-900 text-sm">
                Download Complete Project Archive
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Includes FastAPI backend, NetworkX Louvain Graph pipeline, FAISS vector store, query CLI, and setup scripts.
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                <span className="font-medium text-indigo-700">📦 adaptirag-project.zip</span>
                <span>•</span>
                <span>22 files</span>
                <span>•</span>
                <span>Zero-dependency direct browser download</span>
              </div>
            </div>

            <button
              onClick={handleDownload}
              disabled={isExporting}
              className={`px-5 py-3 rounded-xl font-semibold text-xs flex items-center gap-2 shadow-sm transition-all shrink-0 ${
                downloadSuccess
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white'
              }`}
            >
              {isExporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Packaging ZIP...</span>
                </>
              ) : downloadSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>ZIP Downloaded!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Project (.zip)</span>
                </>
              )}
            </button>
          </div>

          {/* Local Run Guide */}
          <div className="space-y-3">
            <h3 className="font-semibold text-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
              Running After Unzipping
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-800">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                    Option 1: Automated Script
                  </span>
                  <span className="text-[10px] text-zinc-400">Linux / Mac / WSL</span>
                </div>
                <pre className="p-2.5 rounded-lg bg-zinc-900 text-zinc-100 text-xs font-mono overflow-x-auto">
                  ./backend/run_server.sh
                </pre>
                <p className="text-[11px] text-zinc-500">
                  Automatically creates virtual environment, installs requirements, and starts FastAPI on port 8000.
                </p>
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-zinc-800">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-600" />
                    Option 2: Standalone CLI
                  </span>
                  <span className="text-[10px] text-zinc-400">Terminal Query</span>
                </div>
                <pre className="p-2.5 rounded-lg bg-zinc-900 text-zinc-100 text-xs font-mono overflow-x-auto">
                  python3 query_cli.py --ask "What is Paxos?"
                </pre>
                <p className="text-[11px] text-zinc-500">
                  Directly queries the adaptive router agent with bracketed source chunk citations.
                </p>
              </div>
            </div>
          </div>

          {/* In-Browser File Inspector & Copy */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
                Inspect / Copy Individual Source Files
              </h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border border-zinc-200 hover:bg-zinc-100 text-zinc-700 transition-colors"
              >
                {copiedFile ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Selected File</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-zinc-200 rounded-xl overflow-hidden bg-white">
              {/* File List */}
              <div className="border-r border-zinc-200 p-2 max-h-64 overflow-y-auto space-y-1 bg-zinc-50/50">
                {PROJECT_FILES.map(file => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFilePath(file.path)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                      selectedFilePath === file.path
                        ? 'bg-indigo-600 text-white font-medium shadow-xs'
                        : 'text-zinc-600 hover:bg-zinc-200/60'
                    }`}
                  >
                    <span className="truncate">{file.path}</span>
                    <span className={`text-[10px] ${selectedFilePath === file.path ? 'text-indigo-200' : 'text-zinc-400'}`}>
                      {(file.size / 1024).toFixed(1)}k
                    </span>
                  </button>
                ))}
              </div>

              {/* File Viewer */}
              <div className="col-span-2 p-3 bg-zinc-950 text-zinc-100 font-mono text-xs max-h-64 overflow-y-auto select-all">
                <pre className="whitespace-pre-wrap leading-relaxed">
                  {currentFile.content}
                </pre>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            AdaptiRAG Architecture: FAISS + Louvain Community GraphRAG
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-200 text-zinc-700 hover:bg-zinc-300 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
