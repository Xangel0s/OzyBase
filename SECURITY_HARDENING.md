# Security Hardening: Authentication Improvements 🛡️

Este documento detalla las mejoras de seguridad implementadas en el sistema de autenticación de FlowKore Core para mitigar vulnerabilidades críticas.

## Vulnerabilidades Identificadas 💡

- **Contraseñas Débiles**: Los usuarios podían registrarse con contraseñas vacías o muy cortas, facilitando ataques de fuerza bruta.
- **Correos Electrónicos Inválidos**: Falta de validación en el formato de correo electrónico, lo que permitía datos corruptos en la base de datos.

## Soluciones Implementadas 🔧

Se han añadido validaciones robustas en el controlador `Signup` (`internal/api/auth.go`):

1.  **Validación de Formato de Email**: Se utiliza el paquete nativo `net/mail` para asegurar que el correo electrónico siga un formato RFC 5322 válido.
2.  **Longitud Mínima de Contraseña**: Se ha establecido un requisito mínimo de **8 caracteres** para todas las nuevas cuentas.

## Verificación de Seguridad ✅

Se ha creado una suite de pruebas unitarias en `internal/api/auth_test.go` que confirma:
- El registro falla con error `400 Bad Request` si el email es inválido.
- El registro falla con error `400 Bad Request` si la contraseña tiene menos de 8 caracteres.

### Ejecutar Pruebas
```bash
go test ./internal/api
```

---
*Reporte de Seguridad - Jules & FlowKore Team*
