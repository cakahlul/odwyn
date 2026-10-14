import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {webUrl,publicAddress} from '../security.js';
export function blockedDomain(value){
 if(typeof value!=='string'||!value.trim()||/[\s/:?#@*\\]/.test(value.trim()))throw new Error('Use domain names such as example.com, without URLs, ports or wildcards.');
 const domain=domainToASCII(value.trim().toLowerCase().replace(/\.$/,'')).toLowerCase();
 if(!domain||domain.length>253||domain.split('.').some(label=>!label||label.length>63||! /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw new Error('Invalid blocked domain.');return domain;
}
export function browserUrl(metadata,raw){
 const url=webUrl(raw),host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');
 if(isIP(host)&&!publicAddress(host))throw new Error('Private and reserved network destinations are blocked.');
 if(Object.hasOwn(metadata,'readUrls')){if(!metadata.readUrls.includes(raw))throw new Error('Browser URL outside reviewed read scope.');}
 else if(Array.isArray(metadata.blockedDomains)){if(metadata.blockedDomains.some(domain=>host===domain||host.endsWith('.'+domain)))throw new Error('Website is prohibited by this Browsing resource.');}
 else throw new Error('Browser scope unavailable.');
 url.hash='';return url;
}
export function browserCapability(action){
 if(action==='read')return 'browser.read';if(action==='navigate')return 'browser.navigate';
 if(['click','fill','type','select','press','scroll','wait'].includes(action))return 'browser.interact';
 throw new Error('Unsupported isolated browser action.');
}
