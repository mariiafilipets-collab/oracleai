import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const IS_BSC_TESTNET = process.env.NEXT_PUBLIC_CHAIN_TARGET === "bsc_testnet";
const BSC_TESTNET_RPC =
  process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

export const selectedChain = defineChain({
  id: IS_BSC_TESTNET ? 97 : 31338,
  name: IS_BSC_TESTNET ? "BNB Smart Chain Testnet" : "BNB Chain Local",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: [IS_BSC_TESTNET ? BSC_TESTNET_RPC : "http://127.0.0.1:8545"] },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [selectedChain],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    97: http(BSC_TESTNET_RPC),
    31338: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});
