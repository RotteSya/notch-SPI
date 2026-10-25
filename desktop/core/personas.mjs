// Selection belongs to the editor; only activate changes the capture persona.
export function changePersona(settings,action,value) {
  const personas=(settings.personas??[]).map(x=>({...x}));
  let active=settings.persona?.id;
  if(action==='add') {personas.push({...value});if(!active)active=value.id;}
  if(action==='update') {
    const index=personas.findIndex(x=>x.id===value?.id);
    if(index<0||typeof value.name!=='string'||typeof value.description!=='string'||value.description.length>16000)throw new Error('Invalid persona');
    personas[index]={id:value.id,name:value.name.trim(),description:value.description};
  }
  if(action==='activate'&&personas.some(x=>x.id===value))active=value;
  if(action==='remove') {
    const index=personas.findIndex(x=>x.id===value);if(index>=0)personas.splice(index,1);
    if(active===value)active=null;
  }
  return {personas,persona:{...(personas.find(x=>x.id===active)??{id:'',name:'',description:''})}};
}
