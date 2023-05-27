import {expectType, expectNotAssignable, expectNotType} from 'tsd';
import {CacheItem} from './cache-item.js';

type Primitive = boolean | number | string;
type Value = Primitive | Primitive[] | Record<string, any>;

const item = new CacheItem<string>('key');

expectType<Promise<boolean>>(item.isCached());
expectType<Promise<void>>(item.delete());

expectType<Promise<Value | undefined>>(item.get());
expectType<Promise<string | undefined>>(item.get());
expectNotAssignable<Promise<number | undefined>>(item.get());
expectNotType<Promise<string>>(item.set('string'));

// @ts-expect-error Type is string
await item.set(1);

// @ts-expect-error Type is string
await item.set(true);

// @ts-expect-error Type is string
await item.set([true, 'string']);

// @ts-expect-error Type is string
await item.set({wow: [true, 'string']});

// @ts-expect-error Type is string
await item.set(1, {days: 1});
