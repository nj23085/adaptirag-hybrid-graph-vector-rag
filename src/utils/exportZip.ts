import JSZip from 'jszip';

export interface ProjectFile {
  path: string;
  description: string;
  size: number;
  content: string;
}

export const PROJECT_FILES: ProjectFile[] = [
  {
    path: 'README.md',
    description: 'Project architecture and execution guide',
    size: 1200,
    content: '# AdaptiRAG - Hybrid Graph-Vector RAG\n\nRun backend: python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload\nRun frontend: npm run dev\n'
  }
];

export async function downloadProjectZip(): Promise<void> {
  const zip = new JSZip();
  zip.file('README.md', PROJECT_FILES[0].content);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'adaptirag-project.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}