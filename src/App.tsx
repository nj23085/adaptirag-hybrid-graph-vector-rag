import React, { useState } from 'react';
import { Header } from './components/Header';
import { DocumentChatApp } from './components/DocumentChatApp';
import { EfficiencyChunksPage } from './components/EfficiencyChunksPage';
import { UserRole } from './types';

const defaultUser: UserRole = {
  email: 'admin@adaptirag.local',
  role: 'admin',
  name: 'System Administrator',
  token: ''
};

export default function App() {
  const [page, setPage] = useState<'chat' | 'insights'>('chat');

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <Header page={page} onNavigate={setPage} apiBase="" />

      <main className="min-h-0 flex-1">
        {/* Chat stays mounted (just hidden) so switching pages does not lose the conversation */}
        <div className={page === 'chat' ? 'h-full' : 'hidden'}>
          <DocumentChatApp currentUser={defaultUser} apiBase="" />
        </div>
        {page === 'insights' && (
          <div className="h-full overflow-y-auto">
            <EfficiencyChunksPage apiBase="" />
          </div>
        )}
      </main>
    </div>
  );
}