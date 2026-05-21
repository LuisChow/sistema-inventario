import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StockMoves } from './stock-moves';

describe('StockMoves', () => {
  let component: StockMoves;
  let fixture: ComponentFixture<StockMoves>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockMoves],
    }).compileComponents();

    fixture = TestBed.createComponent(StockMoves);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
