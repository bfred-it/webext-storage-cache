import chromeP from 'webext-polyfill-kinda';
import {isBackground, isExtensionContext} from 'webext-detect';
import toMilliseconds, {type TimeDescriptor} from '@sindresorhus/to-milliseconds';

const cacheDefault = {days: 30};

export function timeInTheFuture(time: TimeDescriptor): number {
	return Date.now() + toMilliseconds(time);
}

type Primitive = boolean | number | string;
type Value = Primitive | Primitive[] | Record<string, any>;
// No circular references: Record<string, Value> https://github.com/Microsoft/TypeScript/issues/14174
// No index signature: {[key: string]: Value} https://github.com/microsoft/TypeScript/issues/15300#issuecomment-460226926

type CachedValue<Value> = {
	data: Value;
	maxAge: number;
};

type Cache<ScopedValue extends Value = Value> = Record<string, CachedValue<ScopedValue>>;

async function has(key: string): Promise<boolean> {
	return (await _get(key, false)) !== undefined;
}

export async function _get<ScopedValue extends Value>(
	key: string,
	remove: boolean,
): Promise<CachedValue<ScopedValue> | undefined> {
	const internalKey = `cache:${key}`;
	const storageData: Cache<ScopedValue> = await chromeP.storage.local.get(internalKey);
	const cachedItem = storageData[internalKey];

	if (cachedItem === undefined) {
		// `undefined` means not in cache
		return;
	}

	if (Date.now() > cachedItem.maxAge) {
		if (remove) {
			await chromeP.storage.local.remove(internalKey);
		}

		return;
	}

	return cachedItem;
}

async function get<ScopedValue extends Value>(
	key: string,
): Promise<ScopedValue | undefined> {
	const cachedValue = await _get<ScopedValue>(key, true);
	return cachedValue?.data;
}

async function set<ScopedValue extends Value>(
	key: string,
	value: ScopedValue,
	maxAge: TimeDescriptor = cacheDefault,
): Promise<ScopedValue> {
	if (arguments.length < 2) {
		throw new TypeError('Expected a value as the second argument');
	}

	if (value === undefined) {
		await delete_(key);
	} else {
		const internalKey = `cache:${key}`;
		await chromeP.storage.local.set({
			[internalKey]: {
				data: value,
				maxAge: timeInTheFuture(maxAge),
			},
		});
	}

	return value;
}

async function delete_(userKey: string): Promise<void> {
	const internalKey = `cache:${userKey}`;
	return chromeP.storage.local.remove(internalKey);
}

async function deleteWithLogic(
	logic?: (x: CachedValue<Value>) => boolean,
): Promise<void> {
	let removableItems: string[] = [];
	// `getKeys`: https://github.com/w3c/webextensions/issues/601#issuecomment-2434544881
	const allKeys = await chrome.storage.local.getKeys?.() ?? [];
	const cacheKeys = allKeys.filter(key => key.startsWith('cache:'));
	if (!logic && typeof chrome.storage.local.getKeys === 'function') {
		removableItems = cacheKeys;
	} else {
		const wholeCache: Cache = await chromeP.storage.local.get(cacheKeys);
		for (const [key, value] of Object.entries(wholeCache)) {
			if (key.startsWith('cache:') && (logic?.(value) ?? true)) {
				removableItems.push(key);
			}
		}
	}

	if (removableItems.length > 0) {
		await chromeP.storage.local.remove(removableItems);
	}
}

/** @deprecated Private API for testing only. This happens automatically via chrome.alarms */
export async function _deleteExpired(): Promise<void> {
	await deleteWithLogic(cachedItem => Date.now() > cachedItem.maxAge);
}

async function clear(): Promise<void> {
	await deleteWithLogic();
}

export type CacheKey<Arguments extends unknown[]> = (arguments_: Arguments) => string;

export type MemoizedFunctionOptions<Arguments extends unknown[], ScopedValue> = {
	maxAge?: TimeDescriptor;
	staleWhileRevalidate?: TimeDescriptor;
	cacheKey?: CacheKey<Arguments>;
	shouldRevalidate?: (cachedValue: ScopedValue) => boolean;
};

/** @deprecated Use CachedValue and CachedFunction instead */
const cache = {
	has,
	get,
	set,
	clear,
	delete: delete_,
};

function init(): void {
	// Make it available globally for ease of use
	if (isExtensionContext()) {
		(globalThis as any).webextStorageCache = cache;
	}

	// Automatically clear cache every day
	if (!isBackground()) {
		return;
	}

	if (chrome.alarms) {
		void chrome.alarms.create('webext-storage-cache', {
			delayInMinutes: 1,
			periodInMinutes: 60 * 24,
		});

		let lastRun = 0; // Homemade debouncing due to `chrome.alarms` potentially queueing this function
		chrome.alarms.onAlarm.addListener(alarm => {
			if (
				alarm.name === 'webext-storage-cache'
				&& lastRun < Date.now() - 1000
			) {
				lastRun = Date.now();
				void _deleteExpired();
			}
		});
	} else {
		setTimeout(_deleteExpired, 60_000); // Purge cache on launch, but wait a bit
		setInterval(_deleteExpired, 1000 * 3600 * 24);
	}
}

init();

export default cache;
