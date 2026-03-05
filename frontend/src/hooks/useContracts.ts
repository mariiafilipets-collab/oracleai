"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export function useContractAddresses() {
  const { contractAddresses, setContractAddresses } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (Object.keys(contractAddresses).length > 0) {
      setLoading(false);
      return;
    }

    api.getContracts().then((res) => {
      if (res.success && res.data) {
        setContractAddresses(res.data);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [contractAddresses, setContractAddresses]);

  return { addresses: contractAddresses, loading };
}
