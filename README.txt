Files in this package:

1) build_itv_uz_only.js
   Downloads the source M3U and keeps only entries where:
   group-title="Itv.uz (🇺🇿)"

2) .github/workflows/update-itv-uz-only.yml
   GitHub Actions workflow that rebuilds itv_uz_only.m3u every 30 minutes
   and commits the change if the playlist content changed.

How to use:
- Put both files into your GitHub repository.
- Run the workflow manually once, or wait for the schedule.
- Your repository will contain the latest filtered itv_uz_only.m3u file.
