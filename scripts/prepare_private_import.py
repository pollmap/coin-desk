"""Prepare an explicitly local import folder. Never put private archives in public/dist."""
import argparse, hashlib, json, shutil
from pathlib import Path


def copy_checked(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError('Existing output differs; use another output directory: ' + target.name)
    if not target.exists(): shutil.copy2(source, target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest: raise ValueError('Copy hash mismatch')
    return digest

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--archive',type=Path,required=True)
    p.add_argument('--attachments',type=Path,required=True)
    p.add_argument('--attachment-manifest',type=Path,required=True)
    p.add_argument('--attachment-prefix',required=True)
    p.add_argument('--category-image',type=Path)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    if any(part.lower() in ('public','dist','.git') for part in a.out.resolve().parts): raise ValueError('Public output forbidden')
    counts={'posts':0,'archive_images':0,'attachments':0,'missing_attachments':[]}
    for author in ('token_night','Astro1062'):
        source=a.archive/author
        copy_checked(source/'posts.jsonl', a.out/author/'posts.jsonl')
        with (source/'posts.jsonl').open(encoding='utf-8-sig') as stream:
            for line in stream:
                if not line.strip(): continue
                row=json.loads(line);counts['posts']+=1
                for media in row.get('images',[]):
                    rel=Path(media['file']);src=(source/rel).resolve()
                    if not src.is_relative_to(source.resolve()): raise ValueError('Unsafe media path')
                    copy_checked(src,a.out/author/rel);counts['archive_images']+=1
    rows=[]
    captions=json.loads(a.attachment_manifest.read_text(encoding='utf-8'))
    sources=[(a.attachments/(a.attachment_prefix+suffix+'.jpg'), caption) for suffix,caption in captions.items()]
    if a.category_image: sources.append((a.category_image,('코인 베팅 목록 화면 · 분석 자료 아님','사용자 첨부',None)))
    for file,(title,author,recipe) in sources:
        if not file.is_file(): counts['missing_attachments'].append(file.name);continue
        target=a.out/'attachments'/'images'/file.name
        digest=copy_checked(file,target)
        rows.append({'id':'attachment:'+digest,'author':author,'text':title,'images':[{'file':'images/'+file.name}],
            'review':{'text':False,'images':False,'method':False},
            'note':'첨부 이미지를 분류한 후보입니다. 게시일은 확인되지 않았습니다. 원문 거래소·단위·산식과 자체 계산을 구분합니다.',
            **({'recipe':{'asset':recipe[0],'view':recipe[1],'source':recipe[2],'verified':False}} if recipe else {})})
    folder=a.out/'attachments';folder.mkdir(parents=True,exist_ok=True)
    (folder/'posts.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
    counts['attachments']=len(rows)
    (a.out/'IMPORT-README.txt').write_text('Coin Desk 개인 자료함 → 폴더 가져오기에서 이 폴더를 선택하세요.\n원본 이미지 보관은 선택 사항입니다. 재가져오기는 중복 ID를 병합합니다.\n현재 브라우저·사이트 기기에만 저장됩니다. 공개 업로드하지 마세요.\n원문 전체 내용 검토는 별도이며 자동 분류는 후보입니다.\n',encoding='utf-8')
    print(json.dumps(counts,ensure_ascii=False))
if __name__=='__main__': main()
