import { Component, OnInit } from '@angular/core';
import Chart from 'chart.js';

@Component({
  selector: 'app-analytics-charts',
  templateUrl: './analytics-charts.component.html',
  styleUrls: ['./analytics-charts.component.css']
})
export class AnalyticsChartsComponent implements OnInit {
  chartNames = [
    'sales-by-vendor',
    'average-cost-of-goods',
    'current-cost-of-goods',
    'freight-percentage'
  ];
  chart0: any = [];
  chart1: any = [];
  chart2: any = [];

  constructor() {}

  createChart0() {
    this.chart0 = this.chart0.length === 0 && new Chart('myChart0', {
      type: 'line',
      data: {
        labels: [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ],
        datasets: [
          {
            label: '2015',
            data: [10, 8, 6, 5, 12, 8, 16, 17, 6, 7, 6, 10],
          },
        ],
      },
    });
  }

  createChart1() {
    this.chart1 = this.chart1.length === 0 && new Chart('myChart1', {
      type: 'line',
      data: {
        labels: [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ],
        datasets: [
          {
            label: '2015',
            data: [10, 8, 6, 5, 12, 8, 16, 17, 6, 7, 6, 10],
          },
        ],
      },
    });
  }

  createChart2() {
    this.chart2 = this.chart2.length === 0 && new Chart('myChart2', {
      type: 'line',
      data: {
        labels: [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ],
        datasets: [
          {
            label: '2015',
            data: [10, 8, 6, 5, 12, 8, 16, 17, 6, 7, 6, 10],
          },
        ],
      },
    });
  }

  observerCallback(entries) { 
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        this[`createChart${this.chartNames.indexOf(entry.target.id)}`]();
      }
    });
  };

  createObserver(elementID) {
    var observer = new IntersectionObserver(
      this.observerCallback.bind(this),
      { threshold: 0.5 }
      );
    var chart = document.querySelector(elementID);
    observer.observe(chart);
  }

  ngOnInit() {
    this.chartNames.forEach(name => 
      this.createObserver(`#${name}`)
    );
  }

}