import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pendingReports';

// Offline outbox. Same clientUUID is reused on retry => server dedupes (Step 3).
export async function enqueueReport(draft) {
  const items = await listPending();
  items.push({ ...draft, queuedAt: new Date().toISOString() });
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  return items.length;
}

export async function listPending() {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function pendingCount() {
  return (await listPending()).length;
}

async function removePending(clientUUID) {
  const items = await listPending();
  await AsyncStorage.setItem(KEY, JSON.stringify(items.filter((i) => i.clientUUID !== clientUUID)));
}

// postFn(draft) must throw with err.response on server errors (axios does).
// Removes on success OR server-confirmed states (deduped/duplicate). Keeps on
// network failure for later. Drops unprocessable payloads (422) after logging.
export async function flushPending(postFn) {
  const items = await listPending();
  let sent = 0;
  for (const item of items) {
    try {
      await postFn(item);
      await removePending(item.clientUUID);
      sent += 1;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409 || err?.response?.data?.deduped) {
        await removePending(item.clientUUID);
        sent += 1;
      } else if (status === 422) {
        console.warn('dropping unprocessable queued report', item.clientUUID);
        await removePending(item.clientUUID);
      } else {
        break; // network down — stop, keep the rest
      }
    }
  }
  return { sent, kept: (await listPending()).length };
}

export function newClientUUID() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
