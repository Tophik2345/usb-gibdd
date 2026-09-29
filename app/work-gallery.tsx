import { useRef, useState } from 'react';
import { ArrowUpRight, Camera, ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { workPhotos } from '@/lib/work-photos';
import './work-gallery.css';

const assetUrl = (file: string) => `${import.meta.env.BASE_URL}gallery/${file}`;

export default function WorkGallery() {
  const [selected, setSelected] = useState<number | null>(null);
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const lastOpened = useRef(0);
  const photo = selected === null ? null : workPhotos[selected];
  const move = (direction: number) => setSelected(index => index === null ? null : (index + direction + workPhotos.length) % workPhotos.length);

  return <section className="work-gallery" aria-labelledby="work-gallery-title">
    <div className="work-gallery-heading">
      <div>
        <span className="work-gallery-eyebrow"><Camera size={15} aria-hidden="true" /> ФОТОГАЛЕРЕЯ</span>
        <h2 id="work-gallery-title">Работа подразделения</h2>
        <p>ГИБДД в игровом проекте «Россия Онлайн».</p>
      </div>
      <span className="work-gallery-hint"><Expand size={16} aria-hidden="true" /> Нажмите на фото, чтобы рассмотреть</span>
    </div>

    <div className={`work-gallery-grid${workPhotos.length === 1 ? ' is-single' : ''}`}>
      {workPhotos.map((item, index) => <button
        key={item.file}
        type="button"
        className="work-photo"
        ref={node => { cards.current[index] = node; }}
        aria-label={`Открыть фото: ${item.title}`}
        aria-haspopup="dialog"
        onClick={() => { lastOpened.current = index; setSelected(index); }}
      >
        <img src={assetUrl(item.file)} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" />
        <span className="work-photo-caption">
          <span><span className="work-photo-number">{String(index + 1).padStart(2, '0')}</span>{item.title}</span>
          <Expand size={18} aria-hidden="true" />
        </span>
      </button>)}
    </div>
    <p className="work-gallery-credit">Иллюстративные кадры проекта. Источник: <a href="https://majestic-rp.ru/russia-online" target="_blank" rel="noopener noreferrer">официальная галерея Majestic <ArrowUpRight size={13} aria-hidden="true" /></a>.</p>

    <Dialog open={photo !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent
        className="work-photo-viewer"
        showCloseButton={false}
        onCloseAutoFocus={event => { event.preventDefault(); cards.current[lastOpened.current]?.focus(); }}
        onKeyDown={event => {
          if (workPhotos.length < 2) return;
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
          <DialogDescription className="sr-only">{photo.alt}{workPhotos.length > 1 ? ' Переключайте фото стрелками влево и вправо.' : ''} Для закрытия нажмите Escape.</DialogDescription>
          <img className="work-photo-original" src={assetUrl(photo.file)} alt={photo.alt} width={photo.width} height={photo.height} />
          <div className="work-photo-viewer-footer">
            <span aria-live="polite" aria-atomic="true">{(selected ?? 0) + 1} / {workPhotos.length}</span>
            {workPhotos.length > 1 && <div className="work-photo-controls">
              <button type="button" onClick={() => move(-1)} aria-label="Предыдущее фото"><ChevronLeft size={21} aria-hidden="true" /></button>
              <button type="button" onClick={() => move(1)} aria-label="Следующее фото"><ChevronRight size={21} aria-hidden="true" /></button>
            </div>}
            <a href={assetUrl(photo.file)} target="_blank" rel="noopener noreferrer">Открыть оригинал <ArrowUpRight size={15} aria-hidden="true" /></a>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
