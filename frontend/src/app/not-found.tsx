"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-8xl font-heading font-bold text-neon-cyan mb-4">404</h1>
        <h2 className="text-2xl font-heading text-white mb-4">Page Not Found</h2>
        <p className="text-gray-400 mb-8 max-w-md">
          The oracle could not foresee this page. It may have been moved or doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-neon-cyan/10 border border-neon-cyan/30 rounded-xl text-neon-cyan hover:bg-neon-cyan/20 transition-colors font-medium"
        >
          Back to Home
        </Link>
      </motion.div>
    </div>
  );
}
