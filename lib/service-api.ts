import { accountRpc, accountStorage } from './account-session';
import { authConfigured } from './supabase';
import { WorkspaceError } from './workspace-api';
export type ServiceContext = { userId: string; canManage: boolean; isMember: boolean; members: { id: string; name: string }[] };
export type Photo = { id: string; path: string; title: string; caption: string; width: number; height: number; status: 'draft'|'published'|'archived'; version: number; createdAt: string; url?: string };
export type Point = { x: number; y: number };
export type MapPin = Point & { id: string; title: string; description: string; kind: 'post'|'object' };
export type MapRoute = { id: string; title: string; description?: string; kind: 'route'; points: Point[] };
export type ServiceMapData = { pins: MapPin[]; routes: MapRoute[]; version: number; updatedAt: string };
export type ChecklistProgress = { id: string; checked: string[]; version: number; updatedAt: string|null };
export type ServiceCase = { id: string; assigned_id: string|null; assigned_name?: string; subject: string; body: string; due_at: string|null; appeal_id: string|null; status: 'open'|'in_review'|'closed'; decision: string; version: number; created_at: string; updated_at: string; events?: { id: string; actor_login: string; body: string; evidence: string[]; created_at: string }[] };
export const caseStatuses = { open: 'Открыта', in_review: 'На рассмотрении', closed: 'Завершена' } as const;
export type ServiceShift = { id: string; title: string; location: string; starts_at: string; ends_at: string; capacity: number; cancelled: boolean; version: number; members: { id: string; name: string }[] };
export type Replacement = { id: string; shift_id: string; requester_id: string; requesterName: string; shiftTitle: string; startsAt: string; reason: string; status: 'pending'|'accepted'|'rejected'; response: string; replacement_id: string|null; version: number };
export type ShiftPage = { items: ServiceShift[]; requests: Replacement[] };
export async function serviceApi<T>(payload: Record<string, unknown>): Promise<T> {
  if (!authConfigured) throw new WorkspaceError('Сервис временно недоступен.');
  const {data,error} = await accountRpc('knowledge_service',payload,payload.action !== 'photos');
  if (error) {
    if (/^PT4\d\d$/.test(error.code)) throw new WorkspaceError(error.message,Number(error.code.slice(2)));
    throw new WorkspaceError('Не удалось выполнить действие. Проверьте соединение и повторите попытку.');
  }
  return data as T;
}
export async function photoUrls(items: Photo[]): Promise<Photo[]> {
  if (!items.length) return [];
  if (items.some(item => !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(item.path))) throw new Error('Некорректный путь изображения.');
  const {data,error} = await accountStorage(client=>client.storage.from('usb-gallery').createSignedUrls(items.map(item=>item.path),3600),false);
  if (error) throw new Error('Не удалось открыть изображения. Повторите загрузку галереи.');
  const urls = new Map((data || []).filter(item=>!item.error).map(item=>[item.path,item.signedUrl]));
  return items.map(item=>({...item,url:urls.get(item.path)||undefined}));
}
export async function inspectPhoto(file: File) {
  if (file.size > 5*1024*1024 || !file.size) throw new Error('Выберите изображение до 5 МБ.');
  const header = new Uint8Array(await file.slice(0,16).arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((byte,index)=>header[index]===byte);
  const jpeg=header[0]===255&&header[1]===216&&header[2]===255;
  const webp=new TextDecoder().decode(header.slice(0,4))==='RIFF'&&new TextDecoder().decode(header.slice(8,12))==='WEBP';
  const extension = jpeg?'jpg':png?'png':webp?'webp':null;
  if (!extension) throw new Error('Поддерживаются изображения JPEG, PNG и WebP.');
  let image: ImageBitmap;
  try { image=await createImageBitmap(file); } catch { throw new Error('Не удалось прочитать изображение. Выберите другой файл.'); }
  const width=image.width,height=image.height; image.close();
  if (!width||!height||width>12000||height>12000) throw new Error('Размер изображения должен быть не больше 12000 пикселей.');
  return {extension,width,height,contentType:extension==='jpg'?'image/jpeg':`image/${extension}`};
}
export async function uploadPhoto(file: File, id: string, title: string, caption: string) {
  const info=await inspectPhoto(file);
  const prepared=await serviceApi<{id:string;path:string;version:number}>({action:'photoPrepare',id,title,caption,...info});
  const {error} = await accountStorage(client=>client.storage.from('usb-gallery').upload(prepared.path,file,{contentType:info.contentType,upsert:false}));
  if (error && String('statusCode' in error?error.statusCode:'')!=='409') throw new Error('Изображение не загрузилось. Повторите отправку; сохранённый черновик останется в списке.');
  await serviceApi({action:'photoSave',id,version:prepared.version,title,caption});
}
