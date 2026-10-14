import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "../auth/AuthContext.js";
import { useErrorToast } from "../ui/ErrorToast.js";
import { followCs2Series, PushEndpointConflictError, subscribeToPush, unfollowCs2Series } from "./api/cs2Client.js";

type Status = "idle" | "subscribed" | "denied" | "error";

export interface Cs2NotifyMe {
  status: Status;
  busy: boolean;
  supported: boolean;
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

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("Incomplete push subscription");
  await subscribeToPush({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
}

async function waitForServiceWorker(): Promise<ServiceWorkerRegistration> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Push service worker unavailable")), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function useCs2NotifyMe(seriesId: string, initiallyFollowing: boolean): Cs2NotifyMe {
  const { connected, publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const { token, user, signIn } = useAuth();
  const { showError } = useErrorToast();
  const [status, setStatus] = useState<Status>(initiallyFollowing ? "subscribed" : "idle");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const hydrationScopeRef = useRef({ walletAddress, seriesId });
  const localChangeRef = useRef(false);
  const walletRef = useRef(walletAddress);
  walletRef.current = walletAddress;
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true);
  const supported = Boolean(vapidPublicKey && window.isSecureContext &&
    "Notification" in window && "serviceWorker" in navigator && "PushManager" in window &&
    (!ios || standalone));

  useEffect(() => {
    const scopeChanged = hydrationScopeRef.current.walletAddress !== walletAddress ||
      hydrationScopeRef.current.seriesId !== seriesId;
    if (scopeChanged) {
      hydrationScopeRef.current = { walletAddress, seriesId };
      localChangeRef.current = false;
    }
    // Follows hydrate the initial state; a local action owns it until the wallet/series changes.
    if (!scopeChanged && (busyRef.current || localChangeRef.current)) return;
    setStatus(initiallyFollowing ? "subscribed" : "idle");
    if (!initiallyFollowing || !supported || !vapidPublicKey) return;
    let cancelled = false;
    void navigator.serviceWorker.ready.then(async (registration) => {
      const subscription = await registration.pushManager.getSubscription();
      if (cancelled || busyRef.current || localChangeRef.current) return;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      if (!subscription || !usesApplicationServerKey(subscription, applicationServerKey) || Notification.permission !== "granted") {
        setStatus("idle");
      }
    }).catch(() => {
      if (!cancelled && !busyRef.current && !localChangeRef.current) setStatus("error");
    });
    return () => { cancelled = true; };
  }, [initiallyFollowing, walletAddress, seriesId, supported, vapidPublicKey]);

  const toggle = useCallback(async () => {
    if (busyRef.current || !supported || !vapidPublicKey || !walletAddress) return;
    const disabling = status === "subscribed";
    const isCurrentWallet = () => walletRef.current === walletAddress;
    busyRef.current = true;
    localChangeRef.current = true;
    setBusy(true);
    try {
      if (!disabling) {
        // Request permission from the click, before wallet sign-in can consume user activation.
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (!isCurrentWallet()) return;
        if (permission !== "granted") {
          setStatus("denied");
          showError(permission === "denied"
            ? "Notifications are blocked.\nEnable them in your browser settings."
            : "Notifications weren’t enabled.\nPlease try again and allow notifications.");
          return;
        }
      }
      if ((!token || user?.walletAddress !== walletAddress) && !(await signIn())) {
        throw new Error("Wallet sign-in failed");
      }
      if (!isCurrentWallet()) return;
      if (disabling) {
        await unfollowCs2Series(seriesId);
        if (isCurrentWallet()) setStatus("idle");
        return;
      }
      const registration = await waitForServiceWorker();
      if (!isCurrentWallet()) return;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const options = { userVisibleOnly: true, applicationServerKey };
      let subscription = await registration.pushManager.getSubscription();
      if (!isCurrentWallet()) return;
      if (subscription && !usesApplicationServerKey(subscription, applicationServerKey)) {
        if (!(await subscription.unsubscribe())) throw new Error("Could not renew push subscription");
        subscription = null;
      }
      if (!isCurrentWallet()) return;
      subscription ??= await registration.pushManager.subscribe(options);
      if (!isCurrentWallet()) return;
      try {
        await saveSubscription(subscription);
      } catch (error) {
        if (!(error instanceof PushEndpointConflictError)) throw error;
        if (!isCurrentWallet()) return;
        if (!(await subscription.unsubscribe())) throw new Error("Could not renew push subscription");
        if (!isCurrentWallet()) return;
        subscription = await registration.pushManager.subscribe(options);
        if (!isCurrentWallet()) return;
        await saveSubscription(subscription);
      }
      if (!isCurrentWallet()) return;
      await followCs2Series(seriesId);
      if (isCurrentWallet()) setStatus("subscribed");
    } catch {
      if (isCurrentWallet()) {
        setStatus(disabling ? "subscribed" : "error");
        showError(disabling
          ? "Couldn’t turn off notifications.\nPlease try again."
          : "Couldn’t enable notifications.\nPlease try again.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [seriesId, status, supported, vapidPublicKey, walletAddress, token, user, signIn, showError]);

  return { status, busy, supported, walletConnected: connected, toggle };
}
