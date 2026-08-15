import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { JwtAccessPayload } from '../../modules/auth/auth.types';

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/workshop',
})
export class WorkshopGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WorkshopGateway.name);
  private readonly socketUsers = new Map<string, JwtAccessPayload>();

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (typeof client.handshake.headers.authorization === 'string'
          ? client.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : undefined);
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync<JwtAccessPayload>(token);
      this.socketUsers.set(client.id, payload);
      void client.join(`user:${payload.sub}`);
      this.logger.debug(`Socket connected user=${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const user = this.socketUsers.get(client.id);
    this.socketUsers.delete(client.id);
    if (user) {
      this.logger.debug(`Socket disconnected user=${user.sub}`);
    }
  }

  @SubscribeMessage('join.workshop')
  joinWorkshop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { branchId?: string },
  ) {
    const user = this.socketUsers.get(client.id);
    if (!user || !body?.branchId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    if (
      !user.roles.includes('super_admin') &&
      !user.branchIds.includes(body.branchId)
    ) {
      return { ok: false, error: 'FORBIDDEN' };
    }
    void client.join(`workshop:${body.branchId}`);
    void client.join(`branch:${body.branchId}`);
    return {
      ok: true,
      rooms: [`workshop:${body.branchId}`, `branch:${body.branchId}`],
    };
  }

  @SubscribeMessage('leave.workshop')
  leaveWorkshop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { branchId?: string },
  ) {
    if (!body?.branchId) return { ok: false };
    void client.leave(`workshop:${body.branchId}`);
    void client.leave(`branch:${body.branchId}`);
    return { ok: true };
  }

  @SubscribeMessage('join.workorder')
  joinWorkOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workOrderId?: string },
  ) {
    const user = this.socketUsers.get(client.id);
    if (!user || !body?.workOrderId) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    void client.join(`workorder:${body.workOrderId}`);
    return { ok: true, rooms: [`workorder:${body.workOrderId}`] };
  }

  @SubscribeMessage('leave.workorder')
  leaveWorkOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { workOrderId?: string },
  ) {
    if (!body?.workOrderId) return { ok: false };
    void client.leave(`workorder:${body.workOrderId}`);
    return { ok: true };
  }

  emitToWorkshop(branchId: string, event: string, payload: unknown) {
    this.server?.to(`workshop:${branchId}`).emit(event, payload);
  }

  emitToBranch(branchId: string, event: string, payload: unknown) {
    this.server?.to(`branch:${branchId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitToWorkOrder(workOrderId: string, event: string, payload: unknown) {
    this.server?.to(`workorder:${workOrderId}`).emit(event, payload);
  }
}
