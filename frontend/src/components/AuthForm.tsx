'use client';

import { useState } from 'react';
import { useSignInEmailPassword, useSignUpEmailPassword } from '@nhost/nextjs';

export function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const { signInEmailPassword, isLoading: isSignInLoading, isError: isSignInError, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: isSignUpLoading, isError: isSignUpError, error: signUpError } = useSignUpEmailPassword();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLogin) {
      await signInEmailPassword(email, password);
    } else {
      await signUpEmailPassword(email, password);
    }
  };

  const isLoading = isLogin ? isSignInLoading : isSignUpLoading;
  const error = isLogin ? signInError : signUpError;

  return (
    <div className="w-full max-w-md bg-white p-6 sm:p-10 rounded-xl shadow-[0_2px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-200">
      <div className="flex justify-center mb-6">
        <div className="w-12 h-12 rounded bg-blue-600 text-white flex items-center justify-center font-bold text-xl shadow-sm">AI</div>
      </div>
      <h2 className="text-2xl font-bold mb-8 text-center text-slate-900 tracking-tight">
        {isLogin ? 'Log in to your account' : 'Create an account'}
      </h2>
      
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email address</label>
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400 transition-shadow shadow-sm"
            placeholder="you@example.com"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder-slate-400 transition-shadow shadow-sm"
            placeholder="••••••••"
            required
          />
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 text-sm px-4 py-3 rounded">
            {error.message}
          </div>
        )}

        <button 
          type="submit" 
          disabled={isLoading}
          className="w-full bg-blue-600 text-white py-2.5 px-4 rounded-lg font-semibold shadow hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:pointer-events-none mt-2"
        >
          {isLoading ? 'Processing...' : isLogin ? 'Sign In' : 'Sign Up'}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-slate-100 text-center">
        <button 
          onClick={() => setIsLogin(!isLogin)}
          className="text-blue-600 text-sm font-medium hover:text-blue-800 transition-colors"
        >
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
