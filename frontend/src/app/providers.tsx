"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { selectedChain, wagmiConfig } from "@/lib/web3-config";
import "@rainbow-me/rainbowkit/styles.css";
import { useEffect } from "react";
import AnalyticsTracker from "@/components/AnalyticsTracker";

const queryClient = new QueryClient();

function EnsureBnbLocalNetwork() {
  const { isConnected } = useAccount();
  const isTestnet = selectedChain.id === 97;
  const rpc = isTestnet
    ? (process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545")
    : "http://127.0.0.1:8545";
  const chainIdHex = `0x${selectedChain.id.toString(16)}`;
  const chainName = isTestnet ? "BNB Smart Chain Testnet" : "BNB Chain Local";
  const sessionKey = `oai-chain-${selectedChain.id}-network-attempted`;
  useEffect(() => {
    if (!isConnected || typeof window === "undefined") return;
    const ethereum = (window as any).ethereum;
    if (!ethereum?.request) return;
    if (sessionStorage.getItem(sessionKey) === "1") return;
    sessionStorage.setItem(sessionKey, "1");
    (async () => {
      try {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: chainIdHex,
            chainName,
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [rpc],
          }],
        });
      } catch {}
    })();
  }, [isConnected, chainIdHex, chainName, sessionKey, rpc]);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <EnsureBnbLocalNetwork />
        <AnalyticsTracker />
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#00f0ff",
            accentColorForeground: "#050810",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
