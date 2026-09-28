# Offline Geo-IP databases

Open **Investigations → Local Geo-IP database → Load bundled Geo-IP databases**. The worker loads local gzip files, verifies SHA-256 against the manifest, indexes ranges and looks up an entered IP or the loaded case's peer addresses. Results also appear for looked-up IPs in Graph explorer. Export Geo-IP evidence to retain database provenance with results.

The bundle includes DB-IP Lite September 2026 country (717,170 ranges) and ASN (473,272 ranges), for IPv4 and IPv6. Source: https://db-ip.com/db/lite.php . Attribution: [IP Geolocation by DB-IP](https://db-ip.com). Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Provider gzip files are unmodified; indexing happens locally. public/geo/manifest.json records source URLs, release, size and SHA-256. Country and ASN are independent range tables. No city or person identification is provided.

## Updates

On an internet-connected preparation computer, run `python pipeline/update_geo.py --release YYYY-MM`, then `npm run build`. Copy the new distribution to the offline computer. The UI reads the manifest, so updates do not require code changes. Keep DB-IP attribution visible and retain the licence/provenance when redistributing. The free databases have reduced coverage and accuracy.

Alternatively expand **Update or import a database**, choose Country or ASN, enter the actual release month and import the provider CSV or CSV.gz. Country CSV columns: first IP, last IP, country code. ASN CSV columns: first IP, last IP, ASN, organisation. CSV quoting is supported; ranges must not overlap within a table. The existing custom JSON CIDR format is still accepted: an array of {cidr,country,asn,source,license,updated}. Custom results carry supplied provenance and are not DB-IP assertions.

Geo files are limited to 100 MiB compressed/input and 100 MiB after decompression, with at most two million range records per table. Binary search handles range lookup. Parsing and indexing run in a separate worker; Clear / cancel terminates it. Updates remain session-local. Case exports do not embed entire databases; the separate Geo-IP evidence export records database metadata, hashes and results. Keep original observation geography distinct from local enrichment.

Missing matches, private addresses and documentation ranges display unavailable. The synthetic sample deliberately uses documentation addresses: it must not acquire fabricated countries from the real database. Test 8.8.8.8 for a public lookup; no request is sent to that address. Location is approximate and does not establish ownership or origin.
