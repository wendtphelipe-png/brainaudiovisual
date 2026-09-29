import React from 'react';

interface ConstructionPageProps {
  onJoinRoom?: (roomName: string) => void;
  onOpenAdmin?: () => void;
}

export default function ConstructionPage({ onJoinRoom, onOpenAdmin }: ConstructionPageProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center p-6 text-center selection:bg-slate-200">
      <div className="max-w-xl flex flex-col items-center justify-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-slate-900 mb-5 leading-tight">
          Brain Audiovisual
        </h1>
        <div className="w-12 h-[1.5px] bg-slate-300 mb-6" />
        <p className="text-xs sm:text-sm font-medium tracking-[0.22em] uppercase text-slate-500">
          Página em construção
        </p>
      </div>
    </div>
  );
}
