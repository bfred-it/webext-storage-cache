import test from 'ava';
import sinon from 'sinon';
import toMilliseconds from '@sindresorhus/to-milliseconds';
import cache from '../index.js';

const getUsernameDemo = async name => name.slice(1).toUpperCase();

function timeInTheFuture(time) {
	return Date.now() + toMilliseconds(time);
}

function createCache(daysFromToday, wholeCache) {
	for (const [key, data] of Object.entries(wholeCache)) {
		chrome.storage.local.get
			.withArgs(key)
			.yields({[key]: {
				data,
				maxAge: timeInTheFuture({days: daysFromToday}),
			}});
	}
}

test.beforeEach(() => {
	chrome.flush();
	chrome.storage.local.get.yields({});
	chrome.storage.local.set.yields(undefined);
	chrome.storage.local.remove.yields(undefined);
});

test.serial('get() with empty cache', async t => {
	t.is(await cache.get('name'), undefined);
});

test.serial('get() with cache', async t => {
	createCache(10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.get('name'), 'Rico');
});

test.serial('get() with expired cache', async t => {
	createCache(-10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.get('name'), undefined);
});

test.serial('has() with empty cache', async t => {
	t.is(await cache.has('name'), false);
});

test.serial('has() with cache', async t => {
	createCache(10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.has('name'), true);
});

test.serial('has() with expired cache', async t => {
	createCache(-10, {
		'cache:name': 'Rico',
	});
	t.is(await cache.has('name'), false);
});

test.serial('set() without a value', async t => {
	await t.throwsAsync(cache.set('name'), {
		instanceOf: TypeError,
		message: 'Expected a value as the second argument',
	});
});

test.serial('set() with undefined', async t => {
	await cache.set('name', 'Anne');
	await cache.set('name', undefined);
	// Cached value should be erased
	t.is(await cache.has('name'), false);
});

test.serial('set() with value', async t => {
	const maxAge = 20;
	await cache.set('name', 'Anne', {days: maxAge});
	const arguments_ = chrome.storage.local.set.lastCall.args[0];
	t.deepEqual(Object.keys(arguments_), ['cache:name']);
	t.is(arguments_['cache:name'].data, 'Anne');
	t.true(arguments_['cache:name'].maxAge > timeInTheFuture({days: maxAge - 0.5}));
	t.true(arguments_['cache:name'].maxAge < timeInTheFuture({days: maxAge + 0.5}));
});

test.serial('function() with empty cache', async t => {
	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(await call('@anne'), 'ANNE');

	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
	t.true(spy.withArgs('@anne').calledOnce);
	t.is(spy.callCount, 1);
	t.is(chrome.storage.local.set.lastCall.args[0]['cache:spy:@anne'].data, 'ANNE');
});

test.serial('function() with cache', async t => {
	createCache(10, {
		'cache:spy:@anne': 'ANNE',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(await call('@anne'), 'ANNE');

	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
	t.is(chrome.storage.local.set.callCount, 0);
	t.is(spy.callCount, 0);
});

test.serial('function() with expired cache', async t => {
	createCache(-10, {
		'cache:spy:@anne': 'ONNA',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(await cache.get('@anne'), undefined);
	t.is(await call('@anne'), 'ANNE');
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
	t.true(spy.withArgs('@anne').calledOnce);
	t.is(spy.callCount, 1);
	t.is(chrome.storage.local.set.lastCall.args[0]['cache:spy:@anne'].data, 'ANNE');
});

test.serial('function() with empty cache and staleWhileRevalidate', async t => {
	const maxAge = 1;
	const staleWhileRevalidate = 29;

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy, {
		maxAge: {days: maxAge},
		staleWhileRevalidate: {days: staleWhileRevalidate},
	});

	t.is(await call('@anne'), 'ANNE');

	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
	t.is(chrome.storage.local.set.callCount, 1);
	const arguments_ = chrome.storage.local.set.lastCall.args[0];
	t.deepEqual(Object.keys(arguments_), ['cache:spy:@anne']);
	t.is(arguments_['cache:spy:@anne'].data, 'ANNE');

	const expectedExpiration = maxAge + staleWhileRevalidate;
	t.true(arguments_['cache:spy:@anne'].maxAge > timeInTheFuture({days: expectedExpiration - 0.5}));
	t.true(arguments_['cache:spy:@anne'].maxAge < timeInTheFuture({days: expectedExpiration + 0.5}));
});

test.serial('function() with fresh cache and staleWhileRevalidate', async t => {
	createCache(30, {
		'cache:spy:@anne': 'ANNE',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy, {
		maxAge: {days: 1},
		staleWhileRevalidate: {days: 29},
	});

	t.is(await call('@anne'), 'ANNE');

	// Cache is still fresh, it should be used
	t.is(spy.callCount, 0);
	t.is(chrome.storage.local.set.callCount, 0);

	await new Promise(resolve => {
		setTimeout(resolve, 100);
	});

	// Cache is still fresh, it should never be revalidated
	t.is(spy.callCount, 0);
});

test.serial('function() with stale cache and staleWhileRevalidate', async t => {
	createCache(15, {
		'cache:spy:@anne': 'ANNE',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy, {
		maxAge: {days: 1},
		staleWhileRevalidate: {days: 29},
	});

	t.is(await call('@anne'), 'ANNE');

	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
	t.is(chrome.storage.local.set.callCount, 0);

	t.is(spy.callCount, 0, 'It shouldn’t be called yet');

	await new Promise(resolve => {
		setTimeout(resolve, 100);
	});

	t.is(spy.callCount, 1, 'It should be revalidated');
	t.is(chrome.storage.local.set.callCount, 1);
	t.is(chrome.storage.local.set.lastCall.args[0]['cache:spy:@anne'].data, 'ANNE');
});

test.serial('function() varies cache by function argument', async t => {
	createCache(10, {
		'cache:spy:@anne': 'ANNE',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(await call('@anne'), 'ANNE');
	t.is(spy.callCount, 0);

	t.is(await call('@mari'), 'MARI');
	t.is(spy.callCount, 1);
});

test.serial('function() accepts custom cache key generator', async t => {
	createCache(10, {
		'cache:spy:@anne,1': 'ANNE,1',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	await call('@anne', '1');
	t.is(spy.callCount, 0);

	await call('@anne', '2');
	t.is(spy.callCount, 1);

	t.is(chrome.storage.local.get.firstCall.args[0], 'cache:spy:@anne,1');
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne,2');
});

test.serial('function() accepts custom string-based cache key', async t => {
	createCache(10, {
		'cache:CUSTOM:["@anne",1]': 'ANNE,1',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('CUSTOM', spy);

	await call('@anne', 1);
	t.is(spy.callCount, 0);

	await call('@anne', 2);
	t.is(spy.callCount, 1);

	t.is(chrome.storage.local.get.firstCall.args[0], 'cache:CUSTOM:["@anne",1]');
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:CUSTOM:["@anne",2]');
});

test.serial('function() accepts custom string-based with non-primitive parameters', async t => {
	createCache(10, {
		'cache:CUSTOM:["@anne",{"user":[1]}]': 'ANNE,1',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('CUSTOM', spy);

	await call('@anne', {user: [1]});
	t.is(spy.callCount, 0);

	await call('@anne', {user: [2]});
	t.is(spy.callCount, 1);

	t.is(chrome.storage.local.get.firstCall.args[0], 'cache:CUSTOM:["@anne",{"user":[1]}]');
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:CUSTOM:["@anne",{"user":[2]}]');
});

test.serial('function() verifies cache with shouldRevalidate callback', async t => {
	createCache(10, {
		'cache:@anne': 'anne@',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy, {
		shouldRevalidate: value => value.endsWith('@'),
	});

	t.is(await call('@anne'), 'ANNE');
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
	t.is(chrome.storage.local.set.lastCall.args[0]['cache:spy:@anne'].data, 'ANNE');
	t.is(spy.callCount, 1);
});

test.serial('function() avoids concurrent function calls', async t => {
	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(spy.callCount, 0);
	t.is(call('@anne'), call('@anne'));
	await call('@anne');
	t.is(spy.callCount, 1);

	t.not(call('@new'), call('@other'));
	await call('@idk');
	t.is(spy.callCount, 4);
});

test.serial('function() avoids concurrent function calls with complex arguments via cacheKey', async t => {
	const spy = sinon.spy(async (transform, user) => transform(user.name));
	const call = cache.function('spy', spy, {
		cacheKey: ([fn, user]) => JSON.stringify([fn.name, user]),
	});

	t.is(spy.callCount, 0);
	const cacheMePlease = name => name.slice(1).toUpperCase();
	t.is(call(cacheMePlease, {name: '@anne'}), call(cacheMePlease, {name: '@anne'}));
	await call(cacheMePlease, {name: '@anne'});
	t.is(spy.callCount, 1);

	t.not(call(cacheMePlease, {name: '@new'}), call(cacheMePlease, {name: '@other'}));
	await call(cacheMePlease, {name: '@idk'});
	t.is(spy.callCount, 4);
});

test.serial('function() always loads the data from storage, not memory', async t => {
	createCache(10, {
		'cache:spy:@anne': 'ANNE',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(await call('@anne'), 'ANNE');

	t.is(chrome.storage.local.get.callCount, 1);
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');

	createCache(10, {
		'cache:spy:@anne': 'NEW ANNE',
	});

	t.is(await call('@anne'), 'NEW ANNE');

	t.is(chrome.storage.local.get.callCount, 2);
	t.is(chrome.storage.local.get.lastCall.args[0], 'cache:spy:@anne');
});

test.serial('function.fresh() ignores cached value', async t => {
	createCache(10, {
		'cache:spy:@anne': 'OVERWRITE_ME',
	});

	const spy = sinon.spy(getUsernameDemo);
	const call = cache.function('spy', spy);

	t.is(await call.fresh('@anne'), 'ANNE');

	t.true(spy.withArgs('@anne').calledOnce);
	t.is(spy.callCount, 1);
	t.is(chrome.storage.local.get.callCount, 0);
	t.is(chrome.storage.local.set.lastCall.args[0]['cache:spy:@anne'].data, 'ANNE');
});
