# Local Geo-IP adapter

The app accepts a documented, provider-neutral JSON lookup table. It performs IPv4 **and IPv6** longest-prefix matching with bundled ipaddr.js. Unknown/absent matches display **Geo-IP unavailable**. This is local enrichment, not a remote API. The lookup field in Investigations can inspect any observed IP. Dataset-supplied country/ASN stays separately marked `supplied, unverified` or `simulated` in evidence records.

Format (example uses documentation-only addresses and simulated data):

```json
[
  {
    "cidr": "192.0.2.0/24",
    "country": "ZZ",
    "asn": 64512,
    "source": "Synthetic demonstration; not a real lookup",
    "license": "Synthetic example, freely reusable",
    "updated": "2025-01-01"
  },
  {
    "cidr": "2001:db8::/32",
    "country": "ZZ",
    "asn": 64512,
    "source": "Synthetic demonstration; not a real lookup",
    "license": "Synthetic example, freely reusable",
    "updated": "2025-01-01"
  }
]
```

Fields: valid CIDR; two uppercase country letters; nonnegative integer ASN; nonempty source, license and updated. Import at most 20 MiB and 100,000 prefixes. `ZZ` is a simulated/unknown marker, never a real country lookup. No example table is automatically applied.

## Source, licence, import and update

You may use an internally licensed table in this format without downloading anything from the app. For a downloadable provider, [MaxMind GeoLite](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/) offers country and ASN databases; acquisition can require an account/license key and is subject to its [current EULA](https://www.maxmind.com/en/geolite/eula). These are **optional preparation-time** requirements, not runtime application dependencies. No MaxMind data, credentials or licence grant is bundled. Review redistribution terms before sharing any converted table.

1. Acquire country/ASN data under your organisation's licence on an online preparation machine. Follow the provider's [download/update instructions](https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases).
2. Convert the relevant prefixes to the JSON schema above, retaining source/version/licence date. If country and ASN prefix boundaries differ, intersect the ranges during your data preparation. Do not merely join on identical CIDR strings or invent unmatched attributes. This prototype provides the local-format adapter, **not an MMDB/MaxMind converter**.
3. Transfer that local file to the offline workstation, open Investigations → Local Geo-IP enrichment → import it, and query an observed IP. Inspect the displayed source and update date.
4. Refresh via a newly licensed export and re-import. No background update or network download occurs. Geo tables are held in session memory and must be re-imported after reload; they are not included in saved cases.

IP geolocation is approximate and may reflect infrastructure, VPNs, relays, NAT or stale allocation. It does not identify a person, originator or wallet owner. Validate unknown values and disclose provider coverage before using enrichment in reporting.
