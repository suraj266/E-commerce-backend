import { ID, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Product } from '../product/entities/product.entity';
import { ProductBadge } from './entities/label.entity';
import { LabelService } from './label.service';

/**
 * Extends the GraphQL `Product` type with label fields:
 *   - `labels`           computed badges = MANUAL + matching AUTO, by priority.
 *   - `assignedLabelIds` raw MANUAL label ids assigned to the product (so the
 *                        seller product-form can pre-select its picker).
 *
 * Lives in the label module so all label logic stays together; resolves
 * against the already-hydrated Product object (no extra product query).
 */
@Resolver(() => Product)
export class ProductLabelsResolver {
  constructor(private readonly labelService: LabelService) {}

  /** Computed badges on a Product = MANUAL + matching AUTO labels, priority-sorted. Inherits the parent query's auth. */
  @ResolveField(() => [ProductBadge], { name: 'labels' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveLabels(@Parent() product: any): Promise<ProductBadge[]> {
    return this.labelService.deriveBadges(product);
  }

  /** Raw MANUAL label ids on a Product, so the seller form can pre-select its picker. Inherits the parent query's auth. */
  @ResolveField(() => [ID], { name: 'assignedLabelIds' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveAssignedLabelIds(@Parent() product: any): string[] {
    return ((product.labels ?? []) as { id: string }[]).map((l) => l.id);
  }
}
