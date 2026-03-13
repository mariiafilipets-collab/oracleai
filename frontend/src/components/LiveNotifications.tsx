"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Notification {
  id: string;
  type: string;
  message: string;
  timestamp: number;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/+$/, "");

export default function LiveNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    let socket: any = null;

    async function connectSocket() {
      try {
        const { io } = await import("socket.io-client");
        socket = io(API_URL, { transports: ["websocket", "polling"] });

        socket.on("notification:whale", (data: any) => {
          const notif: Notification = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: data.type || "whale",
            message: data.message || "Whale activity detected!",
            timestamp: data.timestamp || Date.now(),
          };
          setNotifications((prev) => [notif, ...prev.slice(0, 4)]);

          // Auto-dismiss after 8 seconds
          setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
          }, 8000);
        });

        socket.on("prediction:vote", (data: any) => {
          // Only show for high-value votes (whale tier)
          if (data.totalVotesYes + data.totalVotesNo > 20) {
            const notif: Notification = {
              id: `vote-${Date.now()}`,
              type: "hot_event",
              message: `Event #${data.eventId} is trending — ${data.totalVotesYes + data.totalVotesNo} votes!`,
              timestamp: Date.now(),
            };
            setNotifications((prev) => [notif, ...prev.slice(0, 4)]);
            setTimeout(() => {
              setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
            }, 6000);
          }
        });
      } catch {}
    }

    connectSocket();
    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {notifications.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            className="glass border border-neon-cyan/20 rounded-xl px-4 py-3 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">
                {n.type === "whale_checkin" ? "\uD83D\uDC33" : n.type === "hot_event" ? "\uD83D\uDD25" : "\uD83D\uDD14"}
              </span>
              <p className="text-sm text-gray-200">{n.message}</p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
