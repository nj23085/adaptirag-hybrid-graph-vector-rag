import React, { useState } from 'react';
import { Shield, Key, UserCheck, Lock, Unlock, AlertCircle, CheckCircle2 } from 'lucide-react';

export const AuthTester: React.FC = () => {
  const [activeRole, setActiveRole] = useState<'admin' | 'user'>('admin');
  const [testEndpointResult, setTestEndpointResult] = useState<{
    endpoint: string;
    allowed: boolean;
    statusCode: number;
    message: string;
  } | null>(null);

  const mockTokens = {
    admin: {
      email: 'admin@adaptirag.ai',
      role: 'admin',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbkBhZGFwdGlyYWcuYWkiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjE3NTk0Mzk1NDh9.c3BvdF9wYXNzX3ZlcmlmaWVk',
      expiresIn: '24 hours',
    },
    user: {
      email: 'user@adaptirag.ai',
      role: 'user',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyQGFkYXB0aXJhZy5haSIsInJvbGUiOiJ1c2VyIiwiZXhwIjoxNzU5NDM5NTQ4fQ.dXNlcl9wYXNzX3ZlcmlmaWVk',
      expiresIn: '24 hours',
    },
  };

  const currentAuth = mockTokens[activeRole];

  const testAccess = (endpoint: string, requiredRole?: string) => {
    if (requiredRole === 'admin' && activeRole !== 'admin') {
      setTestEndpointResult({
        endpoint,
        allowed: false,
        statusCode: 403,
        message: '403 Forbidden: Operation requires admin role credentials.',
      });
    } else {
      setTestEndpointResult({
        endpoint,
        allowed: true,
        statusCode: 200,
        message: '200 OK: Authentication verified and permission granted.',
      });
    }
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-5 border-b border-zinc-100 gap-2">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-zinc-900 tracking-tight">
              JWT Authentication & RBAC Inspector
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
              PRD FR-10
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            JSON Web Tokens with role claims (user vs. admin) for securing ingestion, querying, and routing configurations.
          </p>
        </div>

        {/* Role switch */}
        <div className="inline-flex rounded-lg bg-zinc-100 p-1 border border-zinc-200">
          <button
            onClick={() => {
              setActiveRole('admin');
              setTestEndpointResult(null);
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
              activeRole === 'admin'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-indigo-600" />
            <span>Admin Role</span>
          </button>
          <button
            onClick={() => {
              setActiveRole('user');
              setTestEndpointResult(null);
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center space-x-1.5 ${
              activeRole === 'user'
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>User Role</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Token payload inspector */}
        <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-200 text-xs">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center space-x-2">
              <Key className="w-4 h-4 text-zinc-500" />
              <span className="font-bold text-zinc-800">Decoded JWT Claims</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-zinc-200/80 rounded text-zinc-700">
              HS256 Signature
            </span>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] bg-white p-3 rounded-lg border border-zinc-200">
            <div className="flex justify-between py-0.5 border-b border-zinc-100">
              <span className="text-zinc-400">sub (Subject):</span>
              <span className="text-indigo-600 font-semibold">{currentAuth.email}</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-100">
              <span className="text-zinc-400">role (RBAC):</span>
              <span className={`font-semibold uppercase ${activeRole === 'admin' ? 'text-amber-600' : 'text-emerald-600'}`}>
                {currentAuth.role}
              </span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-100">
              <span className="text-zinc-400">token_type:</span>
              <span className="text-zinc-700">bearer</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-zinc-400">expires_in:</span>
              <span className="text-zinc-700">{currentAuth.expiresIn}</span>
            </div>
          </div>

          <div className="mt-3">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Raw Bearer Token Preview
            </span>
            <div className="font-mono text-[10px] text-zinc-500 bg-zinc-100/80 p-2 rounded truncate select-all border border-zinc-200/60">
              Bearer {currentAuth.token}
            </div>
          </div>
        </div>

        {/* Role permission simulator */}
        <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-200 text-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-2 mb-2.5">
              <Lock className="w-4 h-4 text-zinc-500" />
              <span className="font-bold text-zinc-800">Role-Based Permission Tester</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3">
              Test invoking endpoints with current identity ({activeRole}):
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-zinc-200">
                <div>
                  <span className="font-mono text-zinc-800 font-semibold">POST /documents</span>
                  <p className="text-[10px] text-zinc-400">Upload & chunk document (Role: user or admin)</p>
                </div>
                <button
                  onClick={() => testAccess('POST /documents')}
                  className="px-2.5 py-1 text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 rounded text-zinc-700 transition-colors"
                >
                  Test Request
                </button>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-zinc-200">
                <div>
                  <span className="font-mono text-zinc-800 font-semibold">PATCH /admin/settings</span>
                  <p className="text-[10px] text-zinc-400">Tune router threshold (Role: admin only)</p>
                </div>
                <button
                  onClick={() => testAccess('PATCH /admin/settings', 'admin')}
                  className="px-2.5 py-1 text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 rounded text-zinc-700 transition-colors"
                >
                  Test Request
                </button>
              </div>
            </div>
          </div>

          {/* Test result display */}
          {testEndpointResult && (
            <div
              className={`mt-3 p-3 rounded-lg border flex items-start space-x-2.5 text-xs ${
                testEndpointResult.allowed
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {testEndpointResult.allowed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-mono font-bold text-[11px]">
                  [{testEndpointResult.statusCode}] {testEndpointResult.endpoint}
                </div>
                <p className="text-[11px] mt-0.5">{testEndpointResult.message}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
