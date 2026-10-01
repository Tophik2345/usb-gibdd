import {browserDraftStorage,cacheDraft,removeDraft,draftSignature,editableTest,editorApi,type PreparedDraft,type EditorDraft,type DraftStorage} from './editor-drafts';
import {WorkspaceError} from './workspace-api';
import type {Test} from './types';
export type DraftState={status:'empty'|'local'|'saving'|'saved'|'error'|'conflict';message:string;localSaved:boolean;record:EditorDraft};
export class DraftSaver {
  private pending:Promise<EditorDraft>|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private disposed=false;
  private paused=false;
  private localSaved=true;
  private state:DraftState;
  constructor(private userId:string,private draft:PreparedDraft,private notify:(state:DraftState)=>void,private storage:DraftStorage=browserDraftStorage,private request:typeof editorApi=editorApi){
    this.state={status:draft.conflict?'conflict':draftSignature(draft.record.form)!==draft.synced?'local':draft.record.version?'saved':'empty',message:draft.conflict,localSaved:true,record:draft.record};
  }
  snapshot(){return this.state;}
  private emit(status:DraftState['status'],message=''){
    if(this.disposed)return;
    this.state={status,message,localSaved:this.localSaved,record:this.draft.record};this.notify(this.state);
  }
  private persist(){try{cacheDraft(this.userId,this.draft,this.storage);this.localSaved=true;}catch{this.localSaved=false;}}
  private schedule(delay=1000){clearTimeout(this.timer);if(!this.disposed&&!this.paused&&!this.draft.conflict)this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},delay);}
  start(){if(this.draft.record.version>0)this.persist();if(draftSignature(this.draft.record.form)!==this.draft.synced){this.persist();this.emit(this.state.status,this.state.message);this.schedule();}}
  update(form:Test){
    if(this.disposed)return;
    this.draft.record={...this.draft.record,form:editableTest(form),updatedAt:new Date().toISOString()};this.persist();
    this.emit(this.draft.conflict?'conflict':'local',this.draft.conflict);this.schedule();
  }
  async flush():Promise<EditorDraft>{
    clearTimeout(this.timer);
    if(this.disposed)throw new Error('Редактор закрыт.');
    if(this.draft.conflict)throw new WorkspaceError(this.draft.conflict,409);
    if(this.pending){await this.pending;return this.flush();}
    if(this.draft.record.version>0&&draftSignature(this.draft.record.form)===this.draft.synced)return this.draft.record;
    const submitted={...this.draft.record,form:editableTest(this.draft.record.form)};
    this.draft.pending=draftSignature(submitted.form);this.persist();this.emit('saving');
    const task=(async()=>{
      try{
        const saved=await this.request<EditorDraft>('save',{id:submitted.id,version:submitted.version,baseVersion:submitted.baseVersion,form:submitted.form});
        if(this.disposed)throw new Error('Редактор закрыт.');
        this.draft={record:{...saved,form:this.draft.record.form},synced:draftSignature(saved.form),conflict:''};this.persist();
        const more=draftSignature(this.draft.record.form)!==this.draft.synced;this.emit(more?'local':'saved');if(more)this.schedule(0);
        return this.draft.record;
      }catch(error){
        if(!this.disposed){
          const message=error instanceof Error?error.message:'Не удалось сохранить черновик.';
          if(error instanceof WorkspaceError&&error.status===409){this.draft.conflict=message;this.emit('conflict',message);}
          else {this.emit('error',message);if(error instanceof WorkspaceError&&error.status===503)this.schedule(15000);}
        }
        throw error;
      }
    })();
    this.pending=task;
    let saved:EditorDraft;try{saved=await task;}finally{this.pending=null;}
    if(draftSignature(this.draft.record.form)!==this.draft.synced)return this.flush();
    return saved;
  }
  async publish():Promise<Test>{
    const saved=await this.flush();
    // Edits are disabled during publication; any preceding autosave must finish first.
    clearTimeout(this.timer);
    try{const test=await this.request<Test>('publish',{id:saved.id,version:saved.version});try{removeDraft(this.userId,saved.id,this.storage);}catch{}this.dispose();return test;}
    catch(error){if(error instanceof WorkspaceError&&error.status===409){this.draft.conflict=error.message;this.emit('conflict',error.message);}throw error;}
  }
  async discard(){
    clearTimeout(this.timer);this.paused=true;
    try{
      while(this.pending)await this.pending.catch(()=>{});
      clearTimeout(this.timer);
      await this.request('discard',{id:this.draft.record.id,version:this.draft.record.version});
      try{removeDraft(this.userId,this.draft.record.id,this.storage);}catch{}this.dispose();
    }finally{this.paused=false;}
  }

  dispose(){this.disposed=true;clearTimeout(this.timer);}
}
