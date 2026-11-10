#!/usr/bin/with-contenv bash
# The image forbids TCP forwarding by default; the tunnel tests need it.
sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config
