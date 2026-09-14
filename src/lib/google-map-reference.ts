/** An explicitly selected Google feature, never the viewport centre.
 * Used for operator links and ephemeral Places googleMapsUri alike. */
export function googleMapCid(value: unknown): string | null {
  if(typeof value!=='string')return null
  try{
    const u=new URL(value)
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null
    if(!['www.google.com','maps.google.com','www.google.co.jp','maps.google.co.jp','google.com','google.co.jp'].includes(u.hostname))return null
    if(!(u.pathname.startsWith('/maps')||(u.hostname.startsWith('maps.')&&u.pathname==='/')))return null
    const ids:string[]=[]
    const add=(n:bigint)=>{if(n<=BigInt(0)||n>BigInt('18446744073709551615'))throw Error('CID range');ids.push(n.toString())}
    for(const c of u.searchParams.getAll('cid')){if(!/^[1-9]\d{0,19}$/.test(c))return null;add(BigInt(c))}
    for(const text of [...u.searchParams.getAll('ftid'),...u.searchParams.getAll('pb')]){
      for(const m of text.matchAll(/(?:^|!1s)(0x[0-9a-f]+:0x([0-9a-f]+))(?=!|$)/gi))add(BigInt('0x'+m[2]))
    }
    return ids.length&&new Set(ids).size===1?ids[0]:null
  }catch{return null}
}
