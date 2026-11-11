"use client";
// The assistant's name (and the owner's) for the screens: "Jarvis" on Tommy's, whatever the client chose on theirs.
import { useEffect, useState } from "react";

export interface Identity {
  assistant: string;
  owner: string;
  address: string;
  kit: boolean;
}

const DEFAULT: Identity = { assistant: "Jarvis", owner: "Tommy", address: "sir", kit: false };
let cached: Identity | null = null;
let pending: Promise<Identity> | null = null;

export function loadIdentity(): Promise<Identity> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetch("/api/status")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { identity?: Identity } | null) => (cached = d?.identity ?? DEFAULT))
    .catch(() => DEFAULT);
  return pending;
}

export function useIdentity(): Identity {
  const [id, setId] = useState<Identity>(cached ?? DEFAULT);
  useEffect(() => {
    loadIdentity().then(setId);
  }, []);
  return id;
}
