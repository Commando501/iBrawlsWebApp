/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { DeviceInfo } from '../types';

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  role: 'host' | 'client';
  isLocal: boolean;
}

interface ChatOverlayProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isMultiplayer: boolean;
  multiplayerRole: 'host' | 'client' | null;
  deviceInfo: DeviceInfo;
}

export const ChatOverlay: React.FC<ChatOverlayProps> = ({
  messages,
  onSendMessage,
  isMultiplayer,
  multiplayerRole,
  deviceInfo,
}) => {
  const [inputText, setInputText] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(() => deviceInfo.isMobile);
  const [isFocused, setIsFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isCollapsed]);

  useEffect(() => {
    if (deviceInfo.isMobile) {
      setIsCollapsed(true);
    }
  }, [deviceInfo.isMobile]);

  if (!isMultiplayer) return null;

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;
    
    onSendMessage(inputText);
    setInputText('');

    // Re-focus game canvas after clicking send manually
    setTimeout(() => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        // Request pointer-lock if wanted, or just blur input to resume gameplay inputs
        const input = document.getElementById('chat-input-field');
        if (input) input.blur();
        canvas.focus();
      }
    }, 50);
  };

  return (
    <div 
      className={`battle-chat-overlay fixed bottom-[240px] left-[20px] z-40 flex flex-col w-[320px] font-sans transition-all duration-300 pointer-events-auto ${
        deviceInfo.isMobile ? 'battle-chat-mobile' : ''
      } ${
        isCollapsed ? 'h-[40px]' : 'h-[230px]'
      }`}
    >
      {/* Sleek HUD Header */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-slate-950/85 backdrop-blur-md border border-cyan-500/20 rounded-t-lg select-none">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-[#22d3ee] animate-pulse" />
          <span className="text-[10px] font-mono font-extrabold tracking-[0.2em] text-[#22d3ee] uppercase">
            BATTLEGROUND CHAT
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
        </div>
        
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 hover:bg-white/10 text-white/50 hover:text-white rounded transition-colors cursor-pointer"
          title={isCollapsed ? "Expand Chat" : "Collapse Chat"}
        >
          {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Scrollable Message History Panel */}
          <div 
            ref={scrollRef}
            className="flex-grow p-3 overflow-y-auto bg-slate-950/70 backdrop-blur-sm border-x border-cyan-500/10 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-white/10"
          >
            {messages.length === 0 ? (
              <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest text-center my-auto italic">
                No wave reports. Press [ENTER] to broadcast.
              </p>
            ) : (
              messages.map((msg) => {
                const badgeColor = msg.role === 'host' ? 'text-blue-400' : 'text-red-400';
                const senderPrefix = msg.role === 'host' ? '[HOST]' : '[GUEST]';
                
                return (
                  <div 
                    key={msg.id} 
                    className={`flex flex-col gap-0.5 max-w-[95%] animate-fade-in ${
                      msg.isLocal ? 'self-end bg-cyan-950/15 p-1.5 rounded-md border border-cyan-500/5' : 'self-start'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 select-none">
                      <span className={`text-[9px] font-mono font-black ${badgeColor}`}>
                        {senderPrefix} {msg.sender}
                      </span>
                      <span className="text-[8px] font-mono text-white/30">
                        {msg.timestamp}
                      </span>
                    </div>
                    <p className="text-[11px] font-sans text-slate-100 break-words leading-relaxed leading-[1.3] pl-0.5">
                      {msg.text}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {/* Interactive Input Form */}
          <form 
            onSubmit={handleSend}
            className={`flex items-center gap-1.5 p-2 bg-slate-950/85 backdrop-blur-md border border-cyan-500/20 rounded-b-lg border-t border-cyan-500/10 transition-shadow ${
              isFocused ? 'shadow-[0_0_15px_rgba(34,211,238,0.15)] ring-1 ring-cyan-500/30' : ''
            }`}
          >
            <input
              id="chat-input-field"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Broadcast message... [Press Enter]"
              className="flex-grow bg-black/40 border border-white/5 rounded px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-cyan-500/40 outline-none transition-all font-sans"
              maxLength={120}
              autoComplete="off"
            />
            
            <button
              id="chat-send-btn"
              type="submit"
              disabled={!inputText.trim()}
              className={`p-1.5 rounded transition-all flex items-center justify-center ${
                inputText.trim()
                  ? 'bg-[#22d3ee]/15 text-[#22d3ee] border border-[#22d3ee]/35 hover:bg-[#22d3ee]/35 hover:shadow-[0_0_10px_rgba(34,211,238,0.3)] cursor-pointer'
                  : 'bg-white/5 text-white/20 border border-transparent cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </>
      )}
    </div>
  );
};
