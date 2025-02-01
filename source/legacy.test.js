import nodeAssert from 'node:assert';
import sinon from 'sinon';
import {
	test, beforeEach, assert, describe,
} from 'vitest';
import toMilliseconds from '@sindresorhus/to-milliseconds';
import cache, {_deleteExpired} from './legacy.ts';

// Help migration away from AVA
const t = {
	is: assert.equal,
	not: assert.notEqual,
	true: assert.ok,
	deepEqual: assert.deepEqual,
	throwsAsync: nodeAssert.rejects,
};

function timeInTheFuture(time) {
	return Date.now() + toMilliseconds(time);
}

function createCache(daysFromToday, wholeCache) {
	for (const [key, data] of Object.entries(wholeCache)) {
		chrome.storage.local.get
			.withArgs(key)
			.yields({
				[key]: {
					data,
					maxAge: timeInTheFuture({days: daysFromToday}),
				},
			});
	}
}

beforeEach(() => {
	chrome.flush();
	chrome.storage.local.get.yields({});
	chrome.storage.local.set.yields(undefined);
	chrome.storage.local.remove.yields(undefined);
});

test('get() with empty cache', async () => {
	t.is(await cache.get('name'), undefined);
});

test('get() with cache', async () => {
	createCache(10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.get('name'), 'Rico');
});

test('get() with expired cache', async () => {
	createCache(-10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.get('name'), undefined);
});

test('has() with empty cache', async () => {
	t.is(await cache.has('name'), false);
});

test('has() with cache', async () => {
	createCache(10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.has('name'), true);
});

test('has() with expired cache', async () => {
	createCache(-10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.has('name'), false);
});

test('set() without a value', async () => {
	await t.throwsAsync(cache.set('name'), {
		name: 'TypeError',
		message: 'Expected a value as the second argument',
	});
});

test('set() with undefined', async () => {
	await cache.set('name', 'Anne');
	await cache.set('name', undefined);
	// Cached value should be erased
	t.is(await cache.has('name'), false);
});

test('set() with value', async () => {
	const maxAge = 20;
	await cache.set('name', 'Anne', {days: maxAge});
	const arguments_ = chrome.storage.local.set.lastCall.args[0];
	t.deepEqual(Object.keys(arguments_), ['cache:name']);
	t.is(arguments_['cache:name'].data, 'Anne');
	t.true(arguments_['cache:name'].maxAge > timeInTheFuture({days: maxAge - 0.5}));
	t.true(arguments_['cache:name'].maxAge < timeInTheFuture({days: maxAge + 0.5}));
});

describe.each([
	'legacy',
	// 'getKeys',
])('%s', async method => {
	// WARNING: THIS IS NOT WORKING. It probably needs to be implemented via plugins
	// TODO: https://github.com/acvetkov/sinon-chrome#plugins
	// https://github.com/acvetkov/sinon-chrome/issues/113
	chrome.storage.local.getKeys = method === 'getKeys' ? sinon.stub(async () => {
		const whole = await chrome.storage.local.get();
		return Object.keys(whole);
	}) : undefined;

	test('clear() with empty storage', async () => {
		// Early sanity check
		if (method === 'getKeys') {
			t.is(chrome.storage.local.getKeys.callCount, 0);
		}

		await cache.clear();

		if (method === 'getKeys') {
			t.is(chrome.storage.local.getKeys.callCount, 1);
		}

		t.is(chrome.storage.local.remove.callCount, 0);
	});

	test('clear() with empty cache', async () => {
		chrome.storage.local.get
			.withArgs()
			.yields({
				'unrelated-key': 'value',
			});
		await cache.clear();
		t.is(chrome.storage.local.remove.callCount, 0);
	});

	test('clear() with cache', async () => {
		chrome.storage.local.get
			.withArgs()
			.yields({
				'unrelated-key': 'value',
				'cache:name': {data: 'Rico', maxAge: timeInTheFuture({days: 10})},
				'cache:age': {data: 20, maxAge: timeInTheFuture({days: 10})},
			});
		await cache.clear();
		const arguments_ = chrome.storage.local.remove.lastCall.args[0];
		t.deepEqual(arguments_, ['cache:name', 'cache:age']);
	});

	test('expired cache cleaning', async () => {
		chrome.storage.local.get
			.withArgs()
			.yields({
				'unrelated-key': 'value',
				'cache:name': {data: 'Rico', maxAge: timeInTheFuture({days: 10})},
				'cache:age': {data: 20, maxAge: timeInTheFuture({days: -10})},
			});
		await _deleteExpired();
		const arguments_ = chrome.storage.local.remove.lastCall.args[0];
		t.deepEqual(arguments_, ['cache:age']);
	});
});
