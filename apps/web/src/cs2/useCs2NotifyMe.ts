import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "../auth/AuthContext.js";
import { followCs2Series, subscribeToPush, unfollowCs2Series } from "./api/cs2Client.js";

type Status = "idle" | "working" | "subscribed" | "denied" | "error";

export interface Cs2NotifyMe {
  status: Status;
  walletConnected: boolean;
  toggle: () => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

function usesApplicationServerKey(subscription: PushSubscription, expectedKey: Uint8Array<ArrayBuffer>): boolean {
  const currentKey = subscription.options.applicationServerKey;
  if (!currentKey) return false;
  const currentBytes = new Uint8Array(currentKey);
  return currentBytes.length === expectedKey.length && currentBytes.every((byte, index) => byte === expectedKey[index]);
}

export function useCs2NotifyMe(seriesId: string, initiallyFollowing: boolean): Cs2NotifyMe {
  const { connected } = useWallet();
  const { token, signIn } = useAuth();
  const [status, setStatus] = useState<Status>(initiallyFollowing ? "subscribed" : "idle");
  const busyRef = useRef(false);

  useEffect(() => {
    if (!initiallyFollowing) return;
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("error");
      return;
    }

    let cancelled = false;
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        if (subscription && usesApplicationServerKey(subscription, applicationServerKey)) return;
        if (subscription) await subscription.unsubscribe();
        if (!cancelled) setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [initiallyFollowing]);

  const toggle = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (status === "subscribed") {
        setStatus("working");
        try {
          await unfollowCs2Series(seriesId);
          setStatus("idle");
        } catch {
          setStatus("subscribed");
        }
        return;
      }
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setStatus("error");
        return;
      }
      setStatus("working");
      try {
        if (!token) await signIn();
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setStatus("denied");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !usesApplicationServerKey(subscription, applicationServerKey)) {
          await subscription.unsubscribe();
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        const { endpoint, keys } = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await subscribeToPush({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
        await followCs2Series(seriesId);
        setStatus("subscribed");
      } catch {
        setStatus("error");
      }
    } finally {
      busyRef.current = false;
    }
  }, [seriesId, status, token, signIn]);

  return { status, walletConnected: connected, toggle };
}
