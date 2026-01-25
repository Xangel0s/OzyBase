# @OzyBase/sdk

The official JavaScript/TypeScript SDK for [OzyBase](https://github.com/Xangel0s/OzyBase) - a high-performance Backend-as-a-Service.

> **Supabase-style API** - If you know Supabase, you know OzyBase.

## Installation

```bash
npm install @OzyBase/sdk
# or
pnpm add @OzyBase/sdk
# or
yarn add @OzyBase/sdk
```

## Quick Start

```typescript
import { createClient } from '@OzyBase/sdk';

// Initialize the client
const OzyBase = createClient('https://your-api.com');

// Sign in
const { data, error } = await OzyBase.auth.signIn({
  email: 'user@example.com',
  password: 'password123'
});

// Query data
const { data: products } = await OzyBase
  .from('products')
  .select('*')
  .eq('active', true);
```

## Features

- 🔐 **Authentication** - Email/password auth with session management
- 📊 **Database** - Fluent query builder with filters, ordering, and pagination
- ⚡ **Realtime** - Subscribe to database changes via SSE
- 📝 **TypeScript** - Full type safety with TypeGen support
- 🪶 **Zero Dependencies** - Uses native `fetch` only
- 🎯 **Supabase-Compatible** - Familiar API if you've used Supabase

---

## Authentication

### Sign Up

```typescript
const { data, error } = await OzyBase.auth.signUp({
  email: 'new@user.com',
  password: 'SecurePass123!'
});

if (error) {
  console.error('Signup failed:', error.message);
} else {
  console.log('Welcome!', data.user);
}
```

### Sign In

```typescript
const { data, error } = await OzyBase.auth.signIn({
  email: 'user@example.com',
  password: 'password123'
});
```

### Sign Out

```typescript
await OzyBase.auth.signOut();
```

### Get Current User

```typescript
const { data: { user } } = await OzyBase.auth.getUser();
console.log('Current user:', user);
```

### Listen to Auth Changes

```typescript
OzyBase.auth.onAuthStateChange((event, session) => {
  console.log('Auth event:', event);
  console.log('Session:', session);
});
```

---

## Database Queries

### Select Data

```typescript
// Get all records
const { data, error } = await OzyBase
  .from('products')
  .select('*');

// Select specific columns
const { data } = await OzyBase
  .from('products')
  .select('id, name, price');
```

### Filters

```typescript
// Equals
.eq('status', 'active')

// Not equals
.neq('status', 'deleted')

// Greater than / Less than
.gt('price', 100)
.gte('price', 100)
.lt('stock', 10)
.lte('stock', 10)

// Pattern matching
.like('name', '%phone%')
.ilike('name', '%PHONE%')  // case-insensitive

// In array
.in('category', ['electronics', 'gadgets'])

// Is null
.is('deleted_at', null)
```

### Chaining Filters

```typescript
const { data } = await OzyBase
  .from('products')
  .select('*')
  .eq('active', true)
  .gt('price', 50)
  .lt('price', 200)
  .order('created_at', { ascending: false })
  .limit(10);
```

### Insert Data

```typescript
// Single insert
const { data, error } = await OzyBase
  .from('products')
  .insert({
    name: 'New Product',
    price: 99.99,
    active: true
  });

// Bulk insert
const { data } = await OzyBase
  .from('products')
  .insert([
    { name: 'Product 1', price: 10 },
    { name: 'Product 2', price: 20 },
  ]);
```

### Update Data

```typescript
const { data, error } = await OzyBase
  .from('products')
  .update({ price: 149.99 })
  .eq('id', 'product-uuid');
```

### Delete Data

```typescript
const { data, error } = await OzyBase
  .from('products')
  .delete()
  .eq('id', 'product-uuid');
```

### Single Row

```typescript
// Get exactly one row (errors if 0 or >1)
const { data, error } = await OzyBase
  .from('products')
  .select('*')
  .eq('id', 'product-uuid')
  .single();

// Get one or null (no error if not found)
const { data } = await OzyBase
  .from('products')
  .select('*')
  .eq('slug', 'my-product')
  .maybeSingle();
```

### Pagination

```typescript
// Limit results
const { data } = await OzyBase
  .from('products')
  .select('*')
  .limit(10);

// Offset pagination
const { data } = await OzyBase
  .from('products')
  .select('*')
  .range(10, 19);  // items 10-19 (page 2)
```

---

## Realtime Subscriptions

### Subscribe to Changes

```typescript
const channel = OzyBase
  .channel('products')
  .on('INSERT', (payload) => {
    console.log('New product:', payload.new);
  })
  .on('UPDATE', (payload) => {
    console.log('Updated:', payload.new, 'was:', payload.old);
  })
  .on('DELETE', (payload) => {
    console.log('Deleted:', payload.old);
  })
  .subscribe((status) => {
    console.log('Subscription status:', status);
  });
```

### Subscribe to All Events

```typescript
const channel = OzyBase
  .channel('products')
  .on('*', (payload) => {
    console.log(`${payload.eventType}:`, payload);
  })
  .subscribe();
```

### Unsubscribe

```typescript
// Unsubscribe from a channel
channel.unsubscribe();

// Remove all channels
OzyBase.removeAllChannels();
```

---

## TypeScript Support

### With Type Generation (Phase 3)

After running `OzyBase gen-types`:

```typescript
import { createClient } from '@OzyBase/sdk';
import type { Database } from './types/OzyBase';

const OzyBase = createClient<Database>('https://your-api.com');

// Now you get full autocomplete!
const { data } = await OzyBase
  .from('products')  // autocomplete table names
  .select('*')
  .eq('price', 100); // type-safe column names
```

### Manual Types

```typescript
interface Product {
  id: string;
  name: string;
  price: number;
  active: boolean;
  created_at: string;
}

const { data } = await OzyBase
  .from<Product>('products')
  .select('*');

// data is Product[] | null
```

---

## Configuration

```typescript
const OzyBase = createClient('https://your-api.com', {
  // Custom headers
  headers: {
    'X-Custom-Header': 'value',
  },
  
  // Auth configuration
  auth: {
    autoRefreshToken: true,     // Auto-refresh before expiry
    persistSession: true,        // Save to localStorage
    storageKey: 'my-app-auth',  // Custom storage key
  },
});
```

---

## Comparison with Supabase

| Feature | Supabase | OzyBase |
|---------|----------|----------|
| `from('table')` | ✅ | ✅ |
| `.select()` | ✅ | ✅ |
| `.insert()` | ✅ | ✅ |
| `.update()` | ✅ | ✅ |
| `.delete()` | ✅ | ✅ |
| `.eq()`, `.gt()`, etc. | ✅ | ✅ |
| `auth.signIn()` | ✅ | ✅ |
| `.channel().subscribe()` | ✅ | ✅ |
| `{ data, error }` responses | ✅ | ✅ |
| Type Generation | ✅ | ✅ (Phase 3) |
| Self-hosted | ⚠️ Complex | ✅ Single Binary |

---

## License

MIT © [Xangel0s](https://github.com/Xangel0s)

**OzyBase: Power in a single binary.** 🛡️🚀

