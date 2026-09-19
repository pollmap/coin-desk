"""Check repository-relative Markdown links and script/config references offline."""
import pathlib,re,json
root=pathlib.Path(__file__).resolve().parents[1]
errors=[]
for path in [root/'README.md',*(root/'docs').rglob('*.md')]:
 for target in re.findall(r'\]\(([^)]+)\)',path.read_text(encoding='utf-8')):
  if target.startswith(('https:','http:','#','mailto:')):continue
  relative=target.split('#')[0].split(' "')[0]
  if relative and not (path.parent/relative).exists():errors.append(str(path.relative_to(root))+': '+relative)
package=json.loads((root/'package.json').read_text(encoding='utf-8'))
assert package['name']=='coin-desk'
assert (root/'pages/functions/api/[[path]].ts').is_file()
assert not errors, '\n'.join(errors)
print('README/docs relative links and release configuration verified')
