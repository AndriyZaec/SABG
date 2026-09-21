import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "../auth/AuthContext.js";
import { followCs2Series, subscribeToPush } from "./api/cs2Client.js";

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

export function useCs2NotifyMe(seriesId: string): Cs2NotifyMe {
  const { connected } = useWallet();
  const { token, signIn } = useAuth();
  const [status, setStatus] = useState<Status>("idle");

  const toggle = useCallback(async () => {
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
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      const { endpoint, keys } = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribeToPush({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
      await followCs2Series(seriesId);
      setStatus("subscribed");
    } catch {
      setStatus("error");
    }
  }, [seriesId, token, signIn]);

  return { status, walletConnected: connected, toggle };
}
