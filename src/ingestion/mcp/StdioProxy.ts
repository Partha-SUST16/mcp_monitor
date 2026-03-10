import { spawn, ChildProcess } from 'child_process';
import { collector } from '../../core/Collector';
import { sessionManager } from '../../core/SessionManager';
import { ProtocolInterceptor } from './ProtocolInterceptor';

export class StdioProxy {
    private child: ChildProcess | null = null;
    private interceptor: ProtocolInterceptor;

    constructor(private config: { name: string; command: string; env?: Record<string, string> }) {
        this.interceptor = new ProtocolInterceptor(config.name, collector, sessionManager);
    }

    start() {
        const [cmd, ...args] = this.config.command.split(' ');
        this.child = spawn(cmd, args, {
            env: { ...process.env, ...this.config.env },
            stdio: ['pipe', 'pipe', 'inherit'],
        });

        process.stdin.on('data', (chunk: Buffer) => {
            this.interceptor.onFromAgent(chunk);
            this.child!.stdin!.write(chunk);
        });

        this.child.stdout!.on('data', (chunk: Buffer) => {
            this.interceptor.onFromServer(chunk);
            process.stdout.write(chunk);
        });

        this.child.on('exit', (code) => {
            sessionManager.endSession(this.config.name);
            process.exit(code ?? 0);
        });

        process.on('exit', () => this.child?.kill());
    }
}
