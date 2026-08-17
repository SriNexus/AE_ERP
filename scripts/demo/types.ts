export type DemoDocument={collection:string;id:string;data:Record<string,unknown>;preserveOnReset?:boolean};
export type DemoSeedPlan={documents:DemoDocument[];references:Array<{collection:string;id:string;field:string;targetCollection:string;targetId:string}>};
export type DemoCliOptions={apply:boolean;confirm?:string;allowedProjects:string[]};
export type ExistingDocument={exists:boolean;data?:Record<string,unknown>};
