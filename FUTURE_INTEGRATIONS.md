# 🚀 FlowKore Future Integrations Roadmap

Este documento detalla la estrategia para elevar la Developer Experience (DX) al nivel de Supabase/PocketBase.

## 📦 1. Cliente SDK (JavaScript/TypeScript)
Para evitar usar `fetch` crudo en cada proyecto frontend, el siguiente paso es crear una librería npm `@flowkore/js-sdk`.

### Diseño de la API del Cliente
```javascript
import FlowKore from 'flowkore-sdk';

const client = new FlowKore('https://mi-api.com');

// Autenticación
await client.auth.login('user@email.com', '123456');

// CRUD elegante
const laptops = await client.collection('productos').getList(1, 20, {
    filter: 'precio > 1000',
    sort: '-created'
});

// Realtime
client.collection('productos').subscribe('*', (e) => {
    console.log('Cambio en productos:', e.record);
});
```

## 💎 2. Generación de Tipos (Type Generation)
Para lograr el autocompletado en VS Code (Intellisense) basado en tu base de datos real.

### Estrategia de Implementación (Go CLI)
Crear un subcomando en el binario principal: `flowkore gen-types --out ./src/types.ts`.

Lógica del Generador:
1. Conectarse a la DB y leer `_v_collections`.
2. Iterar sobre cada colección y sus campos.
3. Mapear tipos de FlowKore a TypeScript:
   - `text` -> `string`
   - `number` -> `number`
   - `bool` -> `boolean`
   - `json` -> `any`

Escribir un archivo .ts o .d.ts:
```typescript
// Archivo generado automáticamente por FlowKore
export interface Productos {
  id: string;
  nombre: string;
  precio: number;
  activo: boolean;
}

export interface DB {
  productos: Productos;
  // ... otras colecciones
}
```

## 🐧 3. Optimización para Servidores Linux (Producción)
Para que FlowKore vuele en un VPS Linux (Ubuntu/Debian) y sea seguro:

### A. Systemd Service (Demonio)
Crear un archivo `/etc/systemd/system/flowkore.service`:

```ini
[Unit]
Description=FlowKore BaaS
After=network.target postgresql.service

[Service]
User=flowkore
Group=flowkore
ExecStart=/opt/flowkore/flowkore
WorkingDirectory=/opt/flowkore
Restart=always
# Variables de entorno seguras
EnvironmentFile=/opt/flowkore/.env
# Límites de archivos abiertos (para muchas conexiones Realtime)
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### B. Seguridad Hardening
- **Binario Seguro**: Compilar con flags de seguridad y stripped (menor tamaño):
  `go build -ldflags="-s -w" -o flowkore ./cmd/flowkore`
- **Usuario Dedicado**: Nunca correr como root. Crear usuario `flowkore` sin shell.
- **Reverse Proxy**: Siempre poner Nginx o Caddy delante para manejar SSL (HTTPS) y compresión Gzip/Brotli, dejando a FlowKore solo en localhost:8090.

### C. Ajustes del Kernel (Sysctl)
Para soportar miles de conexiones SSE (Realtime):

```bash
# /etc/sysctl.conf
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
fs.file-max = 100000
```

---
**FlowKore: Potencia en un solo binario.** 🛡️🚀
