declare module "parse-srcset" {
    interface SrcsetCandidate {
        url: string;
        w?: number;
        h?: number;
        d?: number;
    }

    export default function parseSrcset(value: string): SrcsetCandidate[];
}
