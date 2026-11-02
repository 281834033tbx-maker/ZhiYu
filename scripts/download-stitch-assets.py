import concurrent.futures
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((root / 'output/stitch-final/images.json').read_text())
assets = root / 'public/stitch'
assets.mkdir(parents=True, exist_ok=True)
urls = {item['src'] for items in data.values() for item in items}

def download(url):
    name = hashlib.sha256(url.encode()).hexdigest()[:16] + '.jpg'
    path = assets / name
    result = subprocess.run(['curl', '-fL', '--retry', '2', '--max-time', '60', url, '-o', str(path)], capture_output=True)
    if result.returncode:
        return url, None
    return url, '/stitch/' + name

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    mapping = dict(executor.map(download, urls))
failed = [url for url, local in mapping.items() if not local]
output = {key: [{'alt': item['alt'], 'src': mapping[item['src']]} for item in items] for key, items in data.items()}
(root / 'app/zhiyu/assets.json').write_text(json.dumps(output, ensure_ascii=False, indent=2))
print(f'Downloaded {len(mapping) - len(failed)}/{len(mapping)} unique assets')
if failed:
    raise RuntimeError(f'{len(failed)} assets failed to download')
