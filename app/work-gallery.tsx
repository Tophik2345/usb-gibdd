import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { workPhotos, type WorkPhoto } from '@/lib/work-photos';
import { serviceApi, photoUrls, type Photo } from '@/lib/service-api';
import { errorMessage } from '@/lib/department-api';
import './work-gallery.css';

const assetUrl = (photo: WorkPhoto) => photo.url || `${import.meta.env.BASE_URL}gallery/${photo.file}`;

export default function WorkGallery() {
  const [selected, setSelected] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Photo[]>([]), [total, setTotal] = useState(0), [limit, setLimit] = useState(20), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const lastOpened = useRef(0);
  useEffect(() => {
    let active=true;setLoading(true);setError('');
    void (async()=>{let items:Photo[]=[],count=0;
      for(let offset=0;offset<limit;offset+=20){const page=await serviceApi<{items:Photo[];total:number}>({action:'photos',offset});items.push(...page.items);count=page.total;if(offset+20>=count)break;}
      const signed=await photoUrls(items);if(active){setUploaded(signed);setTotal(count);}
    })().catch(cause=>{if(active)setError(errorMessage(cause));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[limit,revision]);
  useEffect(()=>{const renew=()=>setRevision(value=>value+1);const timer=window.setInterval(renew,9*60*1000);window.addEventListener('usb-gallery-changed',renew);return()=>{window.clearInterval(timer);window.removeEventListener('usb-gallery-changed',renew);};},[]);
  const photos:WorkPhoto[]=[...workPhotos,...uploaded.filter(item=>item.url).map(item=>({file:item.id,title:item.title,alt:item.caption||item.title,caption:item.caption,width:item.width,height:item.height,url:item.url}))];
  const index=selected===null?-1:photos.findIndex(item=>item.file===selected);
  const photo=index<0?null:photos[index];
  const move=(direction:number)=>setSelected(current=>{const at=photos.findIndex(item=>item.file===current);return at<0?null:photos[(at+direction+photos.length)%photos.length].file;});

  return <section className="work-gallery" aria-labelledby="work-gallery-title">
    <div className="work-gallery-heading">
      <div>
        <span className="work-gallery-eyebrow"><Camera size={15} aria-hidden="true" /> ФОТОГАЛЕРЕЯ</span>
        <h2 id="work-gallery-title">Работа подразделения</h2>
        <p>ГИБДД в игровом проекте «Россия Онлайн».</p>
      </div>
      <span className="work-gallery-hint"><Expand size={16} aria-hidden="true" /> Нажмите на фото, чтобы рассмотреть</span>
    </div>

    <div className={`work-gallery-grid${photos.length === 1 ? ' is-single' : ''}`}>
      {photos.map((item, index) => <button
        key={item.file}
        type="button"
        className="work-photo"
        ref={node => { cards.current[index] = node; }}
        aria-label={`Открыть фото: ${item.title}`}
        aria-haspopup="dialog"
        onClick={() => { lastOpened.current = index; setSelected(item.file); }}
      >
        <img src={assetUrl(item)} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" />
        <span className="work-photo-caption">
          <span><span className="work-photo-number">{String(index + 1).padStart(2, '0')}</span>{item.title}</span>
          <Expand size={18} aria-hidden="true" />
        </span>
      </button>)}
    </div>

    {error && <p className="work-gallery-status" role="alert">{error} <button type="button" className="text-button" onClick={()=>setRevision(value=>value+1)}>Повторить загрузку фотографий</button></p>}
    {total>uploaded.length&&<div className="work-gallery-more"><button type="button" className="button outline" disabled={loading} onClick={()=>setLimit(value=>value+20)}>{loading?'Загружаем…':'Ещё фотографии'}</button></div>}

    <Dialog open={photo !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent
        className="work-photo-viewer"
        showCloseButton={false}
        onCloseAutoFocus={event => { event.preventDefault(); cards.current[lastOpened.current]?.focus(); }}
        onKeyDown={event => {
          if (photos.length < 2) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        {photo && <>
          <div className="work-photo-viewer-heading">
            <DialogTitle>{photo.title}</DialogTitle>
            <DialogClose className="work-photo-close" aria-label="Закрыть фото"><X size={21} aria-hidden="true" /></DialogClose>
          </div>
          <DialogDescription className="sr-only">{photo.alt}{photos.length > 1 ? ' Переключайте фото стрелками влево и вправо.' : ''} Для закрытия нажмите Escape.</DialogDescription>
          <img className="work-photo-original" src={assetUrl(photo)} alt={photo.alt} width={photo.width} height={photo.height} />
          {photo.caption&&<p className="work-photo-full-caption">{photo.caption}</p>}
          <div className="work-photo-viewer-footer">
            <span aria-live="polite" aria-atomic="true">{index + 1} / {photos.length}</span>
            {photos.length > 1 && <div className="work-photo-controls">
              <button type="button" onClick={() => move(-1)} aria-label="Предыдущее фото"><ChevronLeft size={21} aria-hidden="true" /></button>
              <button type="button" onClick={() => move(1)} aria-label="Следующее фото"><ChevronRight size={21} aria-hidden="true" /></button>
            </div>}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
