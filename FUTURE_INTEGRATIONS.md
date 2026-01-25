# 🚀 OzyBase Future Integrations Roadmap

Este documento detalla la estrategia para elevar la Developer Experience (DX) al nivel de Supabase/PocketBase.

## 📦 1. Cliente SDK (JavaScript/TypeScript)
Para evitar usar `fetch` crudo en cada proyecto frontend, el siguiente paso es crear una librería npm `@OzyBase/js-sdk`.

### Diseño de la API del Cliente
```javascript
import OzyBase from 'OzyBase-sdk';

const client = new OzyBase('https://mi-api.com');

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
Crear un subcomando en el binario principal: `OzyBase gen-types --out ./src/types.ts`.

Lógica del Generador:
1. Conectarse a la DB y leer `_v_collections`.
2. Iterar sobre cada colección y sus campos.
3. Mapear tipos de OzyBase a TypeScript:
   - `text` -> `string`
   - `number` -> `number`
   - `bool` -> `boolean`
   - `json` -> `any`

Escribir un archivo .ts o .d.ts:
```typescript
// Archivo generado automáticamente por OzyBase
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
Para que OzyBase vuele en un VPS Linux (Ubuntu/Debian) y sea seguro:

### A. Systemd Service (Demonio)
Crear un archivo `/etc/systemd/system/OzyBase.service`:

```ini
[Unit]
Description=OzyBase BaaS
After=network.target postgresql.service

[Service]
User=OzyBase
Group=OzyBase
ExecStart=/opt/OzyBase/OzyBase
WorkingDirectory=/opt/OzyBase
Restart=always
# Variables de entorno seguras
EnvironmentFile=/opt/OzyBase/.env
# Límites de archivos abiertos (para muchas conexiones Realtime)
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### B. Seguridad Hardening
- **Binario Seguro**: Compilar con flags de seguridad y stripped (menor tamaño):
  `go build -ldflags="-s -w" -o OzyBase ./cmd/OzyBase`
- **Usuario Dedicado**: Nunca correr como root. Crear usuario `OzyBase` sin shell.
- **Reverse Proxy**: Siempre poner Nginx o Caddy delante para manejar SSL (HTTPS) y compresión Gzip/Brotli, dejando a OzyBase solo en localhost:8090.

### C. Ajustes del Kernel (Sysctl)
Para soportar miles de conexiones SSE (Realtime):

```bash
# /etc/sysctl.conf
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
fs.file-max = 100000
```

---
**OzyBase: Potencia en un solo binario.** 🛡️🚀

