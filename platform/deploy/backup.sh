#!/bin/sh
# Nightly logical backup of the production database. Keeps the newest 14 dumps.
set -eu
while true; do
  stamp=$(date +%F-%H%M)
  pg_dump -h postgres -U solluna -Fc solluna > "/backups/solluna-$stamp.dump"
  echo "backup written: solluna-$stamp.dump"
  ls -1t /backups/solluna-*.dump | tail -n +15 | while read -r old; do rm -- "$old"; done
  sleep 86400
done
