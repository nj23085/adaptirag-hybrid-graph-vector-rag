import React, { useState } from 'react';
import { Database, Table, Key, CheckCircle, Clock } from 'lucide-react';
import { TableSchema } from '../types';

const SQLITE_SCHEMA: TableSchema[] = [
  {
    name: 'users',
    phase: 'Phase 1',
    status: 'active',
    description: 'System user accounts with hashed credentials and role-based permissions (user / admin).',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'email', type: 'VARCHAR(255)', desc: 'Unique user email' },
      { name: 'password_hash', type: 'VARCHAR(255)', desc: 'Bcrypt hashed password' },
      { name: 'role', type: 'VARCHAR(50)', desc: "'user' or 'admin'" },
      { name: 'created_at', type: 'DATETIME', desc: 'Creation timestamp' },
    ],
  },
  {
    name: 'documents',
    phase: 'Phase 1',
    status: 'active',
    description: 'Uploaded source files (PDF/DOCX/TXT/MD) with status lifecycle and metadata.',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'filename', type: 'VARCHAR(255)', desc: 'Original filename' },
      { name: 'file_type', type: 'VARCHAR(50)', desc: 'Extension: pdf, docx, txt, md' },
      { name: 'file_size', type: 'INTEGER', desc: 'File length in bytes' },
      { name: 'status', type: 'VARCHAR(50)', desc: 'uploaded | chunking | ready | error' },
      { name: 'chunk_count', type: 'INTEGER', desc: 'Total chunks produced' },
      { name: 'uploaded_at', type: 'DATETIME', desc: 'Upload timestamp' },
      { name: 'user_id', type: 'INTEGER', desc: 'Foreign Key -> users.id' },
    ],
  },
  {
    name: 'chunks',
    phase: 'Phase 1',
    status: 'active',
    description: 'Sliding-window text segments (~500–800 tokens) with precise character boundaries.',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'document_id', type: 'INTEGER', desc: 'Foreign Key -> documents.id (CASCADE)' },
      { name: 'chunk_index', type: 'INTEGER', desc: 'Zero-based sequential position' },
      { name: 'text', type: 'TEXT', desc: 'Full textual chunk body' },
      { name: 'token_estimate', type: 'INTEGER', desc: 'Estimated token count' },
      { name: 'start_char', type: 'INTEGER', desc: 'Source start character offset' },
      { name: 'end_char', type: 'INTEGER', desc: 'Source end character offset' },
      { name: 'embedding_ref', type: 'VARCHAR(255)', desc: 'Vector index pointer (Phase 2)' },
    ],
  },
  {
    name: 'entities',
    phase: 'Phase 3',
    status: 'ready_for_phase',
    description: 'Knowledge graph nodes extracted via LLM (name, category, description).',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'name', type: 'VARCHAR(255)', desc: 'Entity canonical name' },
      { name: 'type', type: 'VARCHAR(100)', desc: 'e.g., PROTOCOL, ALGORITHM' },
      { name: 'description', type: 'TEXT', desc: 'LLM generated entity summary' },
      { name: 'document_id', type: 'INTEGER', desc: 'Foreign Key -> documents.id' },
    ],
  },
  {
    name: 'relationships',
    phase: 'Phase 3',
    status: 'ready_for_phase',
    description: 'Knowledge graph directed edges linking source and target entities.',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'source_entity_id', type: 'INTEGER', desc: 'Foreign Key -> entities.id' },
      { name: 'target_entity_id', type: 'INTEGER', desc: 'Foreign Key -> entities.id' },
      { name: 'description', type: 'TEXT', desc: 'Relationship semantic context' },
      { name: 'weight', type: 'FLOAT', desc: 'Strength/frequency score' },
    ],
  },
  {
    name: 'communities',
    phase: 'Phase 3',
    status: 'ready_for_phase',
    description: 'Topological entity clusters grouped via networkx community detection.',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'level', type: 'INTEGER', desc: 'Hierarchical community level' },
      { name: 'title', type: 'VARCHAR(255)', desc: 'Community descriptive title' },
      { name: 'summary', type: 'TEXT', desc: 'Thematic summary for Map-Reduce' },
      { name: 'member_entity_ids', type: 'JSON', desc: 'Array of entity IDs' },
    ],
  },
  {
    name: 'query_logs',
    phase: 'Phase 4',
    status: 'ready_for_phase',
    description: 'Audit records tracking route selection (local vs global), tokens, and latency.',
    columns: [
      { name: 'id', type: 'INTEGER', key: true, desc: 'Primary Key' },
      { name: 'query_text', type: 'TEXT', desc: 'User question' },
      { name: 'route', type: 'VARCHAR(50)', desc: "'local' (vector) or 'global' (graph)" },
      { name: 'confidence', type: 'FLOAT', desc: 'Router classifier confidence' },
      { name: 'cost_tokens', type: 'INTEGER', desc: 'Total prompt + completion tokens' },
      { name: 'latency_ms', type: 'FLOAT', desc: 'Round-trip duration in ms' },
    ],
  },
];

export const DatabaseViewer: React.FC = () => {
  const [selectedTable, setSelectedTable] = useState<string>('chunks');

  const current = SQLITE_SCHEMA.find((t) => t.name === selectedTable) || SQLITE_SCHEMA[0];

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-5 border-b border-zinc-100 gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-zinc-900 tracking-tight">
              SQLite Relational Schema Inspector
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-200">
              SQLAlchemy Models
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Initialized in <code className="font-mono text-zinc-700">./adaptirag.db</code> with cascading foreign keys and indexes.
          </p>
        </div>

        <div className="flex items-center space-x-1.5 text-xs text-zinc-500 bg-zinc-50 px-2.5 py-1 rounded-lg border border-zinc-200">
          <Database className="w-3.5 h-3.5 text-indigo-600" />
          <span>7 Tables Defined in PRD</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Table Selector */}
        <div className="md:col-span-4 space-y-1.5">
          {SQLITE_SCHEMA.map((table) => {
            const isSelected = selectedTable === table.name;
            const isPhase1 = table.status === 'active';

            return (
              <button
                key={table.name}
                onClick={() => setSelectedTable(table.name)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all flex items-center justify-between ${
                  isSelected
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-950 font-bold shadow-2xs'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <Table className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-600' : 'text-zinc-400'}`} />
                  <span className="font-mono">{table.name}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span
                    className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                      isPhase1
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {table.phase}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Table Detail */}
        <div className="md:col-span-8 bg-zinc-50 rounded-xl p-4 border border-zinc-200 text-xs">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-200">
            <div>
              <span className="font-mono font-bold text-sm text-zinc-900">{current.name}</span>
              <p className="text-[11px] text-zinc-500 mt-0.5">{current.description}</p>
            </div>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                current.status === 'active'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-zinc-200 text-zinc-600'
              }`}
            >
              {current.status === 'active' ? 'Active in Phase 1' : `Ready for ${current.phase}`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-400">
                  <th className="pb-2 font-medium">Column</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/60 font-sans">
                {current.columns.map((col, idx) => (
                  <tr key={idx} className="hover:bg-white/60 transition-colors">
                    <td className="py-2 font-mono text-zinc-900 font-semibold flex items-center space-x-1">
                      {col.key && <Key className="w-3 h-3 text-amber-500 inline mr-1 flex-shrink-0" />}
                      <span>{col.name}</span>
                    </td>
                    <td className="py-2 font-mono text-indigo-600 text-[10px]">{col.type}</td>
                    <td className="py-2 text-zinc-600 text-[11px]">{col.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
