import { create } from "zustand";
import type { Personality, PetAction, PetActionRequest, PetSnapshot, SessionInfo } from "../../shared/pet";

type CloudState = {
  connected: boolean | null;
  accountId: number | null;
  email: string | null;
  registrationOpen: boolean;
  pet: PetSnapshot | null;
  busy: boolean;
  error: string | null;
};

export const useCloudPet = create<CloudState>(() => ({
  connected: null,
  accountId: null,
  email: null,
  registrationOpen: false,
  pet: null,
  busy: false,
  error: null,
}));

class RequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly pet?: PetSnapshot) {
    super(message);
  }
}

async function api<T>(path: string, method = "GET", body?: unknown, accountId = useCloudPet.getState().accountId): Promise<T> {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (accountId !== null) headers.set("X-PetDog-Account", String(accountId));
  const response = await fetch("/pet-api/v1" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new RequestError(response.status, "云端服务暂不可用。");
  }
  const result = await response.json();
  if (!response.ok) throw new RequestError(response.status, result.message ?? "云端暂时无法保存。", result.pet);
  return result as T;
}

type PendingAction = Omit<PetActionRequest, "expectedVersion"> & { accountId: number };
const pending: PendingAction[] = [];
let operation = Promise.resolve();
let refreshQueued = false;
let saveQueued = false;

function run(task: () => Promise<void>) {
  const result = operation.then(async () => {
    useCloudPet.setState({ busy: true, error: null });
    try {
      await task();
      return true;
    } catch (error) {
      useCloudPet.setState({ error: error instanceof RequestError ? error.message : "连接云端失败，请稍后再试。" });
      return false;
    } finally {
      useCloudPet.setState({ busy: false });
    }
  });
  operation = result.then(() => undefined);
  return result;
}

function updatePet(pet: PetSnapshot) {
  useCloudPet.setState((state) => !state.pet || pet.version >= state.pet.version ? { pet } : state);
}

async function loadSession() {
  const session = await api<SessionInfo>("/auth/me");
  const accountId = session.user?.id ?? null;
  const email = session.user?.email ?? null;
  const pet = accountId === null ? null : (await api<{ pet: PetSnapshot | null }>("/pet", "GET", undefined, accountId)).pet;
  if (accountId !== useCloudPet.getState().accountId) pending.length = 0;
  useCloudPet.setState({ connected: true, accountId, email, pet, registrationOpen: session.registrationOpen });
}

export function refreshCloud() {
  if (refreshQueued) return;
  refreshQueued = true;
  void run(async () => {
    try {
      await loadSession();
    } catch (error) {
      useCloudPet.setState({ connected: false });
      throw error;
    }
    await savePending();
  }).finally(() => { refreshQueued = false; });
}

export function signIn(mode: "login" | "register", email: string, password: string) {
  return run(async () => {
    await api("/auth/" + mode, "POST", { email: email.trim(), password });
    await loadSession();
  });
}

export function signOut() {
  return run(async () => {
    await api("/auth/logout", "POST");
    pending.length = 0;
    useCloudPet.setState({ accountId: null, email: null, pet: null, connected: true });
  });
}

export function adoptPet(name: string, personality: Personality) {
  return run(async () => {
    const { pet } = await api<{ pet: PetSnapshot }>("/pet", "POST", { name: name.trim(), personality });
    updatePet(pet);
  });
}

export function renamePet(name: string) {
  return run(async () => {
    const { pet } = await api<{ pet: PetSnapshot }>("/pet/profile", "PATCH", { name: name.trim() });
    updatePet(pet);
  });
}

async function savePending() {
  while (pending.length) {
    const [next] = pending;
    const { pet, accountId } = useCloudPet.getState();
    if (!pet || accountId !== next.accountId) {
      pending.shift();
      continue;
    }

    const { action, requestId } = next;
    const send = (expectedVersion: number) =>
      api<{ pet: PetSnapshot }>("/pet/actions", "POST", { action, requestId, expectedVersion });
    try {
      let result;
      try {
        result = await send(pet.version);
      } catch (error) {
        if (!(error instanceof RequestError) || error.status !== 409 || !error.pet) throw error;
        updatePet(error.pet);
        result = await send(error.pet.version);
      }
      updatePet(result.pet);
      pending.shift();
    } catch (error) {
      // A rejected action may be discarded. A lost response keeps the same request ID for retry.
      if (error instanceof RequestError && [400, 403, 404, 422].includes(error.status)) pending.shift();
      if (error instanceof RequestError && (error.status === 401 || (error.status === 409 && !error.pet))) await loadSession();
      throw error;
    }
  }
}

export function recordPetAction(action: PetAction, owner: number | null) {
  const { accountId, pet } = useCloudPet.getState();
  if (owner === null || owner !== accountId || !pet) return;
  pending.push({ action, accountId, requestId: crypto.randomUUID() });
  if (saveQueued) return;
  saveQueued = true;
  void run(savePending).finally(() => { saveQueued = false; });
}
