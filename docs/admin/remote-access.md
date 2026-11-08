# Remote access

Expose only the BreedOps application through a protected HTTPS entry point.

Never expose directly:

- PostgreSQL;
- raw Supabase service ports;
- service-role credentials.

For remote PWA/offline use, HTTPS is mandatory.

Suitable approaches include a private mesh/VPN or a TLS reverse proxy/tunnel.
Regardless of the network layer, users must still authenticate inside BreedOps.

SSH administration should also use a private/controlled path rather than an
open password-authenticated Internet port.
