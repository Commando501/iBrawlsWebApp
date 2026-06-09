export interface DirectMultiplayerInvite {
  fromId: string;
  roomCode: string;
  inviteToken?: string;
}

interface DirectInviteModalProps {
  invite: DirectMultiplayerInvite;
  onAccept: (roomCode: string, inviteToken?: string) => void;
  onDecline: (fromId: string) => void;
}

interface InviteNotificationsDrawerProps {
  notifications: string[];
}

export function DirectInviteModal({ invite, onAccept, onDecline }: DirectInviteModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 select-none">
      <div className="mobile-modal w-full max-w-sm bg-slate-900 border border-sky-500/35 rounded-2xl p-6 shadow-2xl text-center flex flex-col gap-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex justify-center flex-col items-center gap-1">
          <span className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-[0.2em] mb-1">Combat Invitation</span>
          <div className="w-12 h-12 rounded-full bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 mb-2">
            <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Match invite received!</h3>
        </div>

        <p className="text-xs text-white/70 leading-relaxed">
          Client <strong className="text-amber-400 font-mono text-sm font-black">{invite.fromId}</strong> has invited you. Do you join?
        </p>

        <div className="flex gap-4 mt-2">
          <button
            onClick={() => onAccept(invite.roomCode, invite.inviteToken)}
            className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-xs text-white uppercase font-black tracking-widest transition-all rounded-lg border border-emerald-400/20 shadow-lg cursor-pointer flex items-center justify-center gap-2"
          >
            Yes
          </button>
          <button
            onClick={() => onDecline(invite.fromId)}
            className="flex-1 py-3 bg-white/5 hover:bg-white/10 active:scale-95 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer"
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}

export function InviteNotificationsDrawer({ notifications }: InviteNotificationsDrawerProps) {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-[101] flex flex-col gap-3 pointer-events-none select-none max-w-sm">
      {notifications.map((notification, index) => (
        <div key={`${notification}-${index}`} className="bg-slate-950/95 border border-sky-400/40 rounded-xl px-4 py-3 shadow-xl backdrop-blur-md flex items-center gap-3 pointer-events-auto">
          <span className="w-2 h-2 rounded-full bg-sky-454 bg-sky-400 animate-ping shrink-0" />
          <p className="text-[11px] font-bold text-sky-200 mt-0.5">{notification}</p>
        </div>
      ))}
    </div>
  );
}
