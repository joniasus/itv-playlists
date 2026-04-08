# UZB IPTV Playlists

Бу repository Uzbekistan IPTV provider playlist'ларини автоматик йиғиб, битта умумий файлга сақлайди.

## Providers
- Cinerama UZ 🇺🇿
- Sarkor TV 🇺🇿
- iTV UZ 🇺🇿

## Output
- `all_uzb_iptv_providers.m3u8`

## Sources
- `Cinerama_UZ.m3u8`
- `Sarkor_TV.m3u8`
- iTV source + iTV API (`channelId=1..300`)

## Features
- iTV source'дан `group-title="Itv.uz (🇺🇿)"` каналларни олади
- iTV API билан қўшимча каналларни топади
- source'да бор `streamNumber` бўлса, API duplicate'ни рад қилади
- радио каналларни рўйхат охирига туширади
- ҳар provider `group-title` ига каналлар сонини қўшади
- 3 та playlist'ни битта умумий playlist'га йиғади
- GitHub Actions орқали хар 10 дакикада текширади агар янгиланиш булса all_uzb_iptv_providers.m3u8 автомат янгиланади.

## Final file
`all_uzb_iptv_providers.m3u8`

## Manual run
```bash
node 100.js
